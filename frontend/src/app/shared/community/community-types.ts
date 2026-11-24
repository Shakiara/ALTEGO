// ALTEGO necesita definir los contratos de datos de la comunidad.
// Este módulo declara las estructuras compartidas para intercambiar esos datos con tipos consistentes.
export interface ConversationPoll {
  ends_at:string;
  closed:boolean;
  locked:boolean;
  remaining_seconds:number;
  total:number;
  selected:number|null;
  options:{position:number;label:string;votes:number;percentage:number}[];
}

export const reportReasons = [
  {id:'harassment', label:'Harassment or Bullying'},
  {id:'hate_speech', label:'Hate Speech'},
  {id:'spam', label:'Spam or Misleading Content'},
  {id:'inappropriate', label:'Sexual or Inappropriate Content'},
  {id:'violence', label:'Violence or Threats'},
  {id:'other', label:'Other'},
] as const;
export type ReportReason = typeof reportReasons[number]['id'];

export interface ModerationCase {
  record_id?:number;assigned_to?:number|null;assigned_username?:string|null;author_id?:number|null;moderator_id?:number|null;
  id:string;
  content_type:'post'|'comment'|'reply';
  status:'pending'|'restored'|'removed';
  author:string|null;
  moderator:string|null;
  created_at:string;
  resolved_at:string|null;
  report_count:number;
}
export interface ModerationCaseDetails extends ModerationCase {
  reports?:{id:number;reason:ReportReason;created_at:string;status:string;reporter_id:number|null;reporter:string|null}[];
  history?:{action:string;reason:string|null;created_at:string}[];
  reasons:{reason:ReportReason;total:number}[];
  content:{title:string|null;body:string;images:string[];poll?:ConversationPoll|null}|null;
}
export interface ModerationPage {items:ModerationCase[];next_cursor:string|null;total?:number;}
