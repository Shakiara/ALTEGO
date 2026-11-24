// ALTEGO necesita definir los contratos de relaciones sociales.
// Este módulo declara las estructuras compartidas para intercambiar esos datos con tipos consistentes.
export const reactions = [
  ['like','👍','Like'],['love','❤️','Love'],['haha','😂','Haha'],['wow','😮','Wow'],
  ['sad','😢','Sad'],['angry','😡','Angry'],['adore','🥰','Adore'],['fire','🔥','Fire'],
] as const;
export type Reaction = typeof reactions[number][0];
export interface ReactionSummary {counts:Record<Reaction,number>;total:number;mine:Reaction|null;}
export interface PostEngagement extends ReactionSummary {comment_count:number;}
export interface SocialIdentity {id:number;username:string;display_name:string;avatar_url:string|null;verified_creator?:boolean;}
export interface CommentMention {start:number;end:number;user_id:number;verified_creator?:boolean;}
export interface SocialComment {
  id:string;root_id:string|null;body:string;revision:number;created_at:string;author:SocialIdentity;
  reply_to:{id:string;username:string}|null;reply_count:number;reactions:ReactionSummary;
  mentions:CommentMention[];replies?:CommentPage;
}
export interface CommentPage {items:SocialComment[];next_cursor:string|null;}
export type CommentOrder='oldest'|'newest'|'popular';
export type MentionVisibility='everyone'|'followers'|'following'|'nobody';
export const notificationCategories=[
  ['mentions','Mentions',true],['replies','Replies',true],['new_followers','New Followers',true],
  ['moderation','Moderation',false],['verification','Verification',false],
  ['storage','Product Storage',false],['orders','Orders & Purchases',false],['following_updates','Following Updates',true],
] as const;
export type NotificationCategory=typeof notificationCategories[number][0];
export type OptionalNotification=Extract<typeof notificationCategories[number],readonly [string,string,true]>[0];
export interface SocialPreferences {mention_visibility:MentionVisibility;notifications:Record<NotificationCategory,boolean>;}
export interface SocialNotification {id:string;category:NotificationCategory;title:string;description:string;destination:string|null;created_at:string;count:number;unread:boolean;}
export interface NotificationPage {items:SocialNotification[];unread:number;}
export interface FollowState {required?:boolean;followers:number;following:number;viewer_follows:boolean;}
