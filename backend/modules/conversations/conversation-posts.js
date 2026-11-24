// ALTEGO necesita resolver la publicación y edición de conversaciones.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {planPostDeletion,findPostDeletion,completePermanentDeletion} from '../../infrastructure/storage/permanent-deletion.js';
import {persistConversationImage,readConversationImage} from './conversation-storage.js';
import {creatorStorageEnabled} from '../../infrastructure/storage/storage-identity.js';
import {governanceReady} from "../../infrastructure/schema/readiness.js";
import {removeContent} from '../administration/moderation-content.js';
import {createHash, randomUUID} from 'node:crypto';
import multer from 'multer';
import {id} from '../../core/validation.js';
import {imageBytes} from '../accounts/profile-validation.js';
import {isVerifiedCreator} from '../accounts/profiles.js';
import {withSocialPair} from '../social/social-blocks.js';
import {attachPostEngagement} from './conversation-engagement.js';
import {engagementReady} from '../social/social-notifications.js';
import {postsMigration} from "../../infrastructure/schema/readiness.js";
import {cleanModerationForDeletion} from './conversation-moderation.js';
import {createPoll,parsePoll,readPolls,replacePollOptions} from './conversation-polls.js';
import {moderationReady,postVisibility,readConversation,visiblePost} from './conversation-visibility.js';

const imageLimit = 4 * 1024 * 1024;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {fileSize: imageLimit, files: 8, fields: 4, fieldSize: 12000, parts: 13},
}).array('images', 8);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const timestamp = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{6}$/;
const stamp = "DATE_FORMAT(p.created_at,'%Y-%m-%d %H:%i:%s.%f') AS created, DATE_FORMAT(p.edited_at,'%Y-%m-%d %H:%i:%s.%f') AS edited";
const postSelect = `SELECT p.*, ${stamp}, u.username, up.display_name, JSON_UNQUOTE(JSON_EXTRACT(up.avatar,'$.media_id')) AS avatar_id
  FROM conversation_posts p JOIN users u ON u.id=p.author_id LEFT JOIN user_profiles up ON up.user_id=u.id`;
const fail = (status, code, message) => Object.assign(Error(message), {status, code});
const missing = () => fail(404, 'POST_NOT_FOUND', 'Post Not Found');
const forbidden = () => fail(403, 'POST_FORBIDDEN', 'You cannot modify this post.');
const staleFeed = () => fail(409, 'POST_FEED_CHANGED', 'The pinned post changed. Refresh the feed.');
const date = value => value ? value.replace(' ', 'T') + 'Z' : null;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const maxImages = async (verified, sql, author) => await verified(sql, author) ? 8 : 4;

function postText(body, keys) {
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).some(key => !keys.includes(key))) {
    throw fail(400, 'INVALID_POST', 'Invalid post fields.');
  }
  const {title, description = ''} = body;
  if (typeof title !== 'string' || !title.trim() || title.length > 100) {
    throw fail(400, 'INVALID_POST', 'Enter a title of up to 100 characters.');
  }
  if (typeof description !== 'string' || description.length > 2000) {
    throw fail(400, 'INVALID_POST', 'Description must be at most 2,000 characters.');
  }
  return {title: title.trim(), description: description.trim()};
}

function requireContent(description, imageCount) {
  if (!description && !imageCount) throw fail(400, 'INVALID_POST', 'Add a description or at least one image.');
}

async function ready(sql) {
  const [rows] = await sql.execute('SELECT id FROM schema_migrations WHERE id=?', [postsMigration]);
  if (!rows.length) throw fail(503, 'POSTS_NOT_READY', 'Conversations are temporarily unavailable.');
}

function dto(row) {
  return {
    id: row.public_id,
    author: {
      id: row.author_id,
      username: row.username,
      display_name: row.display_name || row.username,
      verified_creator: Boolean(row.verified_creator),
      avatar_url: uuid.test(row.avatar_id) ? '/api/profile-media/' + row.avatar_id + '/display' : null,
    },
    title: row.title,
    description: row.description,
    created_at: date(row.created),
    edited_at: date(row.edited),
    pinned: Boolean(row.pinned),
    revision: row.revision,
    images: Array.from({length: row.image_count}, (_, position) => ({
      url: '/api/posts/' + row.public_id + '/images/' + position,
    })),
  };
}

async function findPost(sql, author, postId, forUpdate = false) {
  const [[row]] = await sql.execute(
    postSelect + ' WHERE p.author_id=? AND p.public_id=? AND ' + await postVisibility(sql,'p') + (forUpdate ? ' FOR UPDATE' : ''),
    [author, postId],
  );
  if (!row) throw missing();
  return row;
}

function feedCursor(value, author, order) {
  if (value === undefined) return null;
  const invalid = () => fail(400, 'INVALID_POST_CURSOR', 'Invalid post page.');
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,700}$/.test(value)) throw invalid();
  let cursor;
  try { cursor = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')); }
  catch { throw invalid(); }
  if (!cursor || cursor.author !== author || cursor.order !== order ||
      !id(cursor.anchor) || !id(cursor.last) || cursor.last > cursor.anchor ||
      typeof cursor.created !== 'string' || !timestamp.test(cursor.created) ||
      (cursor.pinned !== null && (typeof cursor.pinned !== 'string' || !uuid.test(cursor.pinned)))) throw invalid();
  return cursor;
}

async function feed(pool, author, query, viewer) {
  const order = query.order ?? 'newest';
  if (!['newest', 'oldest'].includes(order) || Object.keys(query).some(key => !['order', 'cursor'].includes(key))) {
    throw fail(400, 'INVALID_POST_ORDER', 'Choose Newest First or Oldest First.');
  }
  const cursor = feedCursor(query.cursor, author, order);
  const sql = await pool.getConnection();
  try {

    await sql.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
    const [[owner]] = await sql.execute('SELECT id FROM users WHERE id=?', [author]);
    if (!owner) throw fail(404, 'CREATOR_NOT_FOUND', 'Creator not found.');
    const community = await moderationReady(sql);
    const visible = community ? visiblePost('p') : 'TRUE';
    const [[pinned]] = await sql.execute(postSelect + ' WHERE p.pinned_author_id=? AND '+visible, [author]);
    const pinId = pinned?.public_id ?? null;
    if (cursor && cursor.pinned !== pinId) throw staleFeed();
    let anchor = cursor?.anchor;
    if (anchor === undefined) {
      const [[head]] = await sql.execute('SELECT COALESCE(MAX(id),0) AS anchor FROM conversation_posts WHERE author_id=?', [author]);
      anchor = head.anchor;
    }
    const pageSize = !cursor && pinned ? 9 : 10;
    const direction = order === 'oldest' ? 'ASC' : 'DESC';
    const comparator = direction === 'ASC' ? '>' : '<';
    const args = [author, anchor];
    let where = 'WHERE p.author_id=? AND p.pinned=0 AND p.id<=? AND '+visible;
    if (cursor) {
      where += ` AND (p.created_at${comparator}? OR (p.created_at=? AND p.id${comparator}?))`;
      args.push(cursor.created, cursor.created, cursor.last);
    }
    const [rows] = await sql.execute(
      `${postSelect} ${where} ORDER BY p.created_at ${direction},p.id ${direction} LIMIT ${pageSize + 1}`, args,
    );
    const items = rows.slice(0, pageSize);
    const last = items.at(-1);
    const next = rows.length > pageSize ? Buffer.from(JSON.stringify({
      author, order, anchor, last: last.id, created: last.created, pinned: pinId,
    })).toString('base64url') : null;
    const posts = pinned ? [pinned,...items] : items;
    const engagement = await engagementReady(sql) ? await attachPostEngagement(sql,posts,viewer) : new Map();
    const polls = community ? await readPolls(sql,posts.map(post=>post.id),viewer) : new Map();
    const verified=await isVerifiedCreator(sql,author);
    const present = post => ({...dto({...post,verified_creator:verified}), ...(engagement.has(post.id) ? {engagement:engagement.get(post.id)} : {}),
      ...(polls.has(post.id) ? {poll:polls.get(post.id)} : {})});
    await sql.commit();
    return {pinned:pinned?present(pinned):null,items:items.map(present),next_cursor:next,
      ...(community ? {community_available:true} : {})};
  } catch (error) {
    await sql.rollback();
    throw error;
  } finally {
    sql.release();
  }
}

async function normalizedImages(files) {
  const images = [];
  for (const file of files) {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype)) {
      throw fail(400, 'INVALID_POST_IMAGE', 'Choose PNG, JPEG or WebP images.');
    }
    const image = await imageBytes(file.buffer, 'banner');
    if (image.mime !== file.mimetype || image.display.length > 2 * 1024 * 1024) {
      throw fail(400, 'INVALID_POST_IMAGE', 'This image cannot be published. Choose a smaller valid image.');
    }
    images.push(image.display);
  }
  return images;
}

export function installConversationPosts(app, pool, requireUser, {verified = isVerifiedCreator,mongo=null} = {}) {
  const profilePath = '/api/creators/:id/posts';
  const postPath = profilePath + '/:postId';
  const respond = operation => async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    try {
      await ready(pool);
      if (req.params.postId !== undefined && !uuid.test(req.params.postId)) throw missing();
      await operation(req, res);
    } catch (error) {
      if (error.code && error.status) return res.status(error.status).json({code: error.code, error: error.message});
      next(error);
    }
  };
  const own = req => {
    if (req.user.id !== req.recordId) throw forbidden();
  };
  const fileInput = (req, res) => new Promise((resolve, reject) => upload(req, res, error => {
    if (!error) return resolve();
    if (!(error instanceof multer.MulterError)) return reject(fail(400, 'INVALID_POST_UPLOAD', 'Invalid image upload.'));
    return reject(fail(400, 'INVALID_POST_UPLOAD', error.code === 'LIMIT_FILE_SIZE'
      ? 'Each image must be at most 4 MB.'
      : 'Too many images or invalid upload fields.'));
  }));

  app.get(profilePath, respond(async (req, res) => res.json(await feed(pool, req.recordId, req.query, req.user?.id))));
  app.get(postPath, respond(async (req, res) => {
    res.json(await readConversation(pool,async sql=>{
      const post=await findPost(sql,req.recordId,req.params.postId);
      const data=dto({...post,verified_creator:await isVerifiedCreator(sql,post.author_id)});
      if (await engagementReady(sql)) data.engagement=(await attachPostEngagement(sql,[post],req.user?.id)).get(post.id);
      if (await moderationReady(sql)) {
        data.community_available=true;
        const poll=(await readPolls(sql,[post.id],req.user?.id)).get(post.id);
        if (poll) data.poll=poll;
      }
      return data;
    }));
  }));
  app.get('/api/posts/:postId/images/:position', respond(async (req, res) => {
    if (!/^[0-7]$/.test(req.params.position)) throw missing();
    const [[row]] = await pool.execute(
      'SELECT i.* FROM conversation_post_images i JOIN conversation_posts p ON p.id=i.post_id WHERE p.public_id=? AND i.position=? AND '+await postVisibility(pool,'p'),
      [req.params.postId, Number(req.params.position)],
    );
    if (!row) throw missing();
    res.set('X-Content-Type-Options', 'nosniff').type('image/webp').send(await readConversationImage(row));
  }));

  app.post(profilePath, requireUser, respond(async (req, res) => {
    own(req);
    if (req.is('multipart/form-data')) await fileInput(req, res);
    else if (!req.is('application/json')) throw fail(415, 'INVALID_POST_UPLOAD', 'Use a supported post format.');
    const {title, description} = postText(req.body, ['title', 'description', 'request_key', 'poll']);
    const poll = parsePoll(req.body.poll);
    if (poll && !await moderationReady(pool)) throw fail(503,'POLLS_NOT_READY','Polls are temporarily unavailable.');
    const requestKey = req.body.request_key;
    if (typeof requestKey !== 'string' || !uuid.test(requestKey)) {
      throw fail(400, 'INVALID_POST_REQUEST', 'Invalid publication request.');
    }
    const files = req.files ?? [];
    if (files.length > await maxImages(verified, pool, req.user.id)) {
      throw fail(400, 'POST_IMAGE_LIMIT', 'Too many images for your account.');
    }
    if (!poll) requireContent(description, files.length);
    const requestContent = [title, description, files.map(file => hash(file.buffer))];
    if (poll) requestContent.push(poll);
    const requestHash = hash(JSON.stringify(requestContent));
    const images = await normalizedImages(files);
    const result = await withSocialPair(pool, req, req.recordId, async sql => {
      const [[prior]] = await sql.execute(
        'SELECT public_id,request_hash FROM conversation_posts WHERE author_id=? AND request_key=?',
        [req.user.id, requestKey],
      );
      if (prior) {
        if (prior.request_hash !== requestHash) throw fail(409, 'POST_REQUEST_CONFLICT', 'This publication request was already used.');
        const existing=await findPost(sql,req.recordId,prior.public_id);
        const data=dto(existing);
        if (poll) data.poll=(await readPolls(sql,[existing.id],req.user.id)).get(existing.id);
        return data;
      }
      if (images.length > await maxImages(verified, sql, req.user.id)) {
        throw fail(400, 'POST_IMAGE_LIMIT', 'Too many images for your account.');
      }
      const postId = randomUUID();
      const [inserted] = await sql.execute(
        'INSERT INTO conversation_posts(public_id,author_id,request_key,request_hash,title,description,image_count,created_at) VALUES (?,?,?,?,?,?,?,UTC_TIMESTAMP(6))',
        [postId, req.user.id, requestKey, requestHash, title, description, images.length],
      );
      for (const [position, bytes] of images.entries()) {
        const stored=await persistConversationImage(sql,req.user.id,postId,position,bytes);
        if(creatorStorageEnabled())await sql.execute('INSERT INTO conversation_post_images(post_id,position,image_bytes,storage_path,storage_sha256) VALUES (?,?,?,?,?)',[inserted.insertId,position,stored.image_bytes,stored.storage_path,stored.storage_sha256]);else await sql.execute('INSERT INTO conversation_post_images(post_id,position,image_bytes) VALUES (?,?,?)',[inserted.insertId,position,bytes]);
      }
      const data=dto(await findPost(sql,req.recordId,postId));
      if (poll) {
        await createPoll(sql,inserted.insertId,poll);
        data.poll=(await readPolls(sql,[inserted.insertId],req.user.id)).get(inserted.insertId);
      }
      return data;
    });
    res.status(201).json(result);
  }));

  app.put(postPath, requireUser, respond(async (req, res) => {
    own(req);
    const {title, description} = postText(req.body, ['title','description','revision','poll_options']);
    const options = req.body.poll_options===undefined ? null : parsePoll({options:req.body.poll_options,days:1}).options;
    if (!Number.isSafeInteger(req.body.revision) || !id(req.body.revision)) {
      throw fail(400, 'INVALID_POST_REVISION', 'Invalid post revision.');
    }
    res.json(await withSocialPair(pool, req, req.recordId, async sql => {
      const post = await findPost(sql, req.recordId, req.params.postId, true);
      if (post.revision !== req.body.revision) throw fail(409, 'POST_CHANGED', 'This post changed. Reopen it and try again.');
      const poll=await moderationReady(sql) ? (await readPolls(sql,[post.id],req.user.id)).get(post.id) : null;
      if (!poll) requireContent(description,post.image_count);
      if (options && (!poll || poll.locked || poll.closed)) {
        throw fail(409,'POLL_LOCKED','Options can only be edited before the first vote on an open poll.');
      }
      const changedText=post.title!==title || post.description!==description;

      if (poll?.locked && changedText) throw fail(409,'POLL_LOCKED','A poll post cannot be edited after voting begins.');
      const changedOptions=options && (options.length!==poll.options.length ||
        options.some((option,index)=>option!==poll.options[index].label));
      if (changedOptions) await replacePollOptions(sql,post.id,options);
      if (changedText || changedOptions) {
        await sql.execute(
          'UPDATE conversation_posts SET title=?,description=?,revision=revision+1,edited_at=UTC_TIMESTAMP(6) WHERE id=?',
          [title, description, post.id],
        );
      }
      const data=dto(await findPost(sql,req.recordId,req.params.postId));
      if (poll) data.poll=changedOptions ? (await readPolls(sql,[post.id],req.user.id)).get(post.id) : poll;
      return data;
    }));
  }));

  app.put(postPath + '/pin', requireUser, respond(async (req, res) => {
    own(req);
    if (!req.body || Object.keys(req.body).length !== 1 || typeof req.body.pinned !== 'boolean') {
      throw fail(400, 'INVALID_POST_PIN', 'Invalid pin request.');
    }
    res.json(await withSocialPair(pool, req, req.recordId, async sql => {
      const post = await findPost(sql, req.recordId, req.params.postId, true);
      if (req.body.pinned) {
        await sql.execute('UPDATE conversation_posts SET pinned=0 WHERE pinned_author_id=? AND id<>?', [req.recordId, post.id]);
      }
      await sql.execute('UPDATE conversation_posts SET pinned=? WHERE id=?', [req.body.pinned, post.id]);
      return dto(await findPost(sql, req.recordId, req.params.postId));
    }));
  }));

  app.delete(postPath, requireUser, respond(async (req, res) => {
    if (req.user.id !== req.recordId && req.user.role !== 'admin') throw forbidden();
    const operation=await withSocialPair(pool, req, req.recordId, async sql => {
      let post;try{post=await findPost(sql,req.recordId,req.params.postId,true);}catch(error){if(error.status===404){const previous=await findPostDeletion(sql,req.recordId,req.params.postId);if(previous)return previous;}throw error;}
      if(req.user.id!==post.author_id&&await governanceReady(sql)){await removeContent(sql,req.user,'post',post.id,req.body);return null;}
      const operation=await planPostDeletion(sql,post);await cleanModerationForDeletion(sql,post.id);await sql.execute('DELETE FROM conversation_posts WHERE id=?',[post.id]);return operation;
    });
    if(operation){const result=await completePermanentDeletion(pool,operation,{mongo});if(result.pending)return res.status(202).json({deletion_pending:true,message:result.error||'Post removed. Physical cleanup is still pending.'});}
    res.status(204).end();
  }));
}
