// ALTEGO necesita resolver las encuestas y sus votos autorizados.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {assertSocialInteractionAllowed, blockError, withSocialPair} from '../social/social-blocks.js';
import {missingConversation, readConversation, visiblePost} from './conversation-visibility.js';

const invalid = message => blockError(400, 'INVALID_POLL', message);

export function parsePoll(input) {
  if (input === undefined) return null;
  let poll = input;
  if (typeof poll === 'string') {
    try { poll = JSON.parse(poll); }
    catch { throw invalid('Invalid poll settings.'); }
  }
  if (!poll || typeof poll !== 'object' || Array.isArray(poll) ||
      Object.keys(poll).length !== 2 || !Array.isArray(poll.options) ||
      poll.options.length < 2 || poll.options.length > 6 ||
      !Number.isInteger(poll.days) || poll.days < 1 || poll.days > 30) {
    throw invalid('Choose 2 to 6 options and a duration of 1 to 30 days.');
  }
  const options = poll.options.map(option => {
    if (typeof option !== 'string') throw invalid('Enter a valid option.');
    const normalized = option.normalize('NFKC').trim().replace(/\s+/gu, ' ');
    if (!normalized || Array.from(normalized).length > 100) throw invalid('Enter 1 to 100 characters per option.');
    return normalized;
  });
  if (new Set(options.map(option => option.toLowerCase())).size !== options.length) {
    throw invalid('Poll options must be different.');
  }
  return {options, days:poll.days};
}

export async function createPoll(sql, postId, poll) {
  await sql.execute('INSERT INTO conversation_polls(post_id,ends_at) VALUES (?,UTC_TIMESTAMP(6)+INTERVAL ? DAY)', [postId,poll.days]);
  await insertOptions(sql,postId,poll.options);
}

async function insertOptions(sql,postId,options) {
  for (const [index,label] of options.entries()) {
    await sql.execute('INSERT INTO conversation_poll_options(post_id,position,label) VALUES (?,?,?)',[postId,index+1,label]);
  }
}

export async function replacePollOptions(sql,postId,options) {
  await sql.execute('DELETE FROM conversation_poll_options WHERE post_id=?',[postId]);
  await insertOptions(sql,postId,options);
}

export async function readPolls(sql, postIds, viewer) {
  const polls = new Map();
  if (!postIds.length) return polls;
  const [rows] = await sql.execute(`SELECT p.post_id,o.position,o.label,
    DATE_FORMAT(COALESCE(p.closed_at,p.ends_at),'%Y-%m-%dT%H:%i:%s.%fZ') AS ends_at,
    COALESCE(p.closed_at,p.ends_at)<=UTC_TIMESTAMP(6) AS closed,
    p.voting_started_at IS NOT NULL AS locked,
    GREATEST(0,CEIL(TIMESTAMPDIFF(MICROSECOND,UTC_TIMESTAMP(6),p.ends_at)/1000000)) AS remaining_seconds,
    COUNT(v.user_id) AS votes,MAX(v.user_id <=> ?) AS selected
    FROM conversation_polls p JOIN conversation_poll_options o ON o.post_id=p.post_id
    LEFT JOIN conversation_poll_votes v ON v.post_id=o.post_id AND v.position=o.position
    WHERE p.post_id IN (${postIds.map(()=>'?').join(',')})
    GROUP BY p.post_id,p.ends_at,p.closed_at,p.voting_started_at,o.position,o.label ORDER BY p.post_id,o.position`, [viewer ?? null,...postIds]);
  for (const row of rows) {
    const poll = polls.get(row.post_id) ?? {ends_at:row.ends_at,closed:Boolean(row.closed),locked:Boolean(row.locked),remaining_seconds:Number(row.remaining_seconds),total:0,selected:null,options:[]};
    const votes = Number(row.votes);
    poll.total += votes;
    if (viewer && row.selected) poll.selected = row.position;
    poll.options.push({position:row.position,label:row.label,votes});
    polls.set(row.post_id,poll);
  }
  for (const poll of polls.values()) {
    for (const option of poll.options) option.percentage = poll.total ? Math.round(option.votes*100/poll.total) : 0;
  }
  return polls;
}

export function installPollActions(app, pool, requireUser, respond) {
  const path = '/api/creators/:id/posts/:postId/poll';
  async function find(sql,req,lock=false) {
    const [[post]] = await sql.execute(`SELECT p.id,p.author_id,poll.closed_at IS NOT NULL OR poll.ends_at<=UTC_TIMESTAMP(6) AS closed
      FROM conversation_posts p JOIN conversation_polls poll ON poll.post_id=p.id
      WHERE p.public_id=? AND p.author_id=? AND ${visiblePost('p')}`+(lock?' FOR UPDATE':''), [req.params.postId,req.recordId]);
    if (!post) throw missingConversation();
    return post;
  }
  const result = async (sql,post,req) => (await readPolls(sql,[post.id],req.user?.id)).get(post.id);
  app.get(path,respond(async(req,res) => res.json(await readConversation(pool, async sql => result(sql,await find(sql,req),req)))));
  app.put(path+'/vote',requireUser,respond(async(req,res) => {
    const position = req.body?.position;
    if (!Number.isInteger(position) || position<1 || position>6 || Object.keys(req.body).length!==1) throw invalid('Choose a valid poll option.');
    res.json(await withSocialPair(pool,req,req.recordId,async sql => {
      const post = await find(sql,req,true);
      await assertSocialInteractionAllowed(sql,req.user.id,post.author_id);
      if (post.closed) throw blockError(409,'POLL_CLOSED','This poll has closed.');
      const [[option]] = await sql.execute('SELECT position FROM conversation_poll_options WHERE post_id=? AND position=?',[post.id,position]);
      if (!option) throw invalid('Choose a valid poll option.');
      await sql.execute(`INSERT INTO conversation_poll_votes(post_id,user_id,position) VALUES (?,?,?)
        ON DUPLICATE KEY UPDATE position=?`,[post.id,req.user.id,position,position]);
      await sql.execute('UPDATE conversation_polls SET voting_started_at=UTC_TIMESTAMP(6) WHERE post_id=? AND voting_started_at IS NULL',[post.id]);
      return result(sql,post,req);
    }));
  }));
  app.put(path+'/close',requireUser,respond(async(req,res) => {
    if (req.user.id!==req.recordId) throw blockError(403,'POLL_FORBIDDEN','Only the author can close this poll.');
    if (req.body?.confirm!==true || Object.keys(req.body).length!==1) throw invalid('Confirm closing this poll.');
    res.json(await withSocialPair(pool,req,req.recordId,async sql => {
      const post = await find(sql,req,true);
      if (!post.closed) await sql.execute('UPDATE conversation_polls SET closed_at=UTC_TIMESTAMP(6) WHERE post_id=?',[post.id]);
      return result(sql,post,req);
    }));
  }));
}
