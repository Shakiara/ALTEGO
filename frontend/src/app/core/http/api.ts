// ALTEGO necesita resolver la comunicación del frontend con los servicios de ALTEGO.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import type {SalesFilters,SalesOverview,SalesPerformance,SaleHistory,SalesPage} from "../../shared/commerce/sales-types";
import {CreatorBadges} from "../../shared/identity/verified-creator-badge";
import type {CreatorDiscoveryPage} from "../../shared/creators/creator-discovery-types";
import type {VerificationApplication,PublicationReview,ReviewDecision,ReviewPage,VerificationEntry,VerificationQueue,VerificationReview,VerificationStatus} from "../../shared/identity/verification-types";
import type {ConversationPoll,ModerationCaseDetails,ModerationPage,ReportReason} from "../../shared/community/community-types";
import type {CommentOrder,CommentPage,FollowState,MentionVisibility,NotificationPage,OptionalNotification,PostEngagement,Reaction,ReactionSummary,SocialComment,SocialPreferences} from "../../shared/social/social-types";
import type {ProfileImage,SocialLink} from "../../shared/profile/profile-types";
import { API_URL, type User } from "../auth/auth-service";
import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import {map,tap} from 'rxjs';
export interface CreatorProfile {id:number;username:string;display_name:string;bio:string|null;avatar_url:string|null;banner_url:string|null;created_at:string|null;verified_creator:boolean;public_links:SocialLink[];avatar:ProfileImage;banner:ProfileImage;revision:number;pinned_product_id:number|null;pinned_item:(Product&{thumbnail_url:string|null})|null;stats:{published_items:number;followers:number|null;following:number|null};viewer_follows?:boolean;follow_required?:boolean;availability:{profile_editing:boolean;following:boolean;reporting:boolean;blocking:boolean;verification:boolean};products:Product[];}
export type PostOrder = 'newest' | 'oldest';
export interface ConversationPost {
  id: string;
  author: {id: number; username: string; display_name: string; avatar_url: string | null; verified_creator?:boolean};
  title: string;
  description: string;
  created_at: string;
  edited_at: string | null;
  pinned: boolean;
  revision: number;
  images: {url: string}[];
  engagement?: PostEngagement;
  poll?: ConversationPoll;
  community_available?: boolean;
}
export interface ConversationPage {items: ConversationPost[]; pinned: ConversationPost | null; next_cursor: string | null; community_available?: boolean;}
export interface AccountSettings {revision:number;account:{id:number;username:string;email:string;display_name:string;display_name_change?:{last_changed_at:string|null;next_change_at:string|null;allowed:boolean}};privacy:{followers_list:'public'|'private';following_list:'public'|'private';counts_public:boolean};}
export interface AccountActivity {id:string;type?:string;category:'content'|'interactions'|'changes';action:string;reference:string;occurred_at:string;description?:string;fields?:{label:string;value:string}[];related_path?:string|null;resource_available?:boolean|null;}
export interface ActivityPage {items:AccountActivity[];next_cursor:string|null;}
export interface BlockUser {id:number;username:string;display_name:string;avatar_url:string|null;blocked?:boolean;}
export interface BlockedUser extends BlockUser {blocked_at:string;}
export interface BlockPage<T> {items:T[];page:number;total:number;total_pages:number;}
export interface BlockState {user_id:number;blocked:boolean;social_restricted:boolean;}
export interface ActiveSession {id:string;device:string;browser:string;device_type:'desktop'|'mobile'|'tablet'|'unknown';last_active_at:string|null;current:boolean;}
export interface AccountSettingsResult {settings:AccountSettings;user:User;}
export interface Category { id:number;name:string;description:string;icon_svg?:string|null;display_order?:number;active?:boolean;filter_visible?:boolean;revision?:number; }
export interface Variant{available?:boolean;id?:string;name:string;hex:string;texture_asset_id:string|null;texture_url?:string|null;is_default:boolean;legacy?:boolean;}
export type StudioVerificationEntry=Pick<VerificationApplication,'id'|'status'|'submitted_at'|'decided_at'|'rejection_reason'|'revoked_at'|'revocation_reason'>;
export interface StudioSummary{sales?:{ready:boolean;total_revenue_cents:number;total_sales:number;products_sold:number;free_acquisitions:number;currency:string};products:{total:number;published:number;pending:number;rejected:number;removed:number;unlisted:number;drafts:number;trash:number};community:{posts:number;comments:number;replies:number;followers:number};recent:{id:string;action:string;reference:string|null;occurred_at:string}[];}
export interface StudioAnalytics{summary:StudioSummary;history:{month:string;products:number;versions:number;posts:number}[];}
export interface StudioCommunityData{posts:{id:string;title:string;pinned:boolean;created_at:string;state:string;comments:number;replies:number;reactions:number}[];received:{id:string;body:string;root_id:number|null;post_id:string;post_title:string;author_id:number;username:string;created_at:string}[];}
export interface Product{ promotional_message?:string;thumbnail_url?:string|null;review_status?:string|null;review_reason?:string|null;review_explanation?:string|null;moderation_removed?:boolean;id:number;owner_id?:number;creator_name?:string;verified_creator?:boolean;publication_pending?:boolean;category_id:number;category:string;name:string;description:string;price:number;model_url:string|null;model_asset_id?:string|null;status:string;revision:number;variants:Variant[];current_version_id?:number;version_number?:number;published_at?:string;profile_order?:number;trashed_at?:string;}
export type ProductInput=Omit<Partial<Product>,'price'>&{price?:number|string};
export interface PublishedVersion{id:number;version_number:number;created_at:string;snapshot:Product;restored_from?:number|null;}
export interface CatalogPage {items:Product[];page:number;limit:number;total:number;total_pages:number;category_counts:{category_id:number;total:number}[];}
export interface Review{revision?:number;edited_at?:string|null;permissions?:{can_edit:boolean;can_delete:boolean;can_report:boolean};verified_purchase?:boolean;_id:string;product_id:number;author:string;author_id?:number;author_identity?:{id:number;username:string};is_anonymous:boolean;rating:number;comment:string;created_at:string;}
export const assetUrl=(url:string|null|undefined)=>url?.startsWith('/api/')?API_URL.replace(/\/api$/,'')+url:url||null;
const normalize=(p:Product):Product=>({...p,model_url:assetUrl(p.model_url),variants:(p.variants||[]).map(v=>({...v,texture_url:assetUrl(v.texture_url)}))});
const normalizeCreator=(c:CreatorProfile):CreatorProfile=>({...c,avatar_url:assetUrl(c.avatar_url),banner_url:assetUrl(c.banner_url),pinned_item:c.pinned_item?{...normalize(c.pinned_item),thumbnail_url:assetUrl(c.pinned_item.thumbnail_url)}:null,products:c.products.map(normalize)});
export interface ProductStorageSummary{plan:string;limit_bytes:number|null;used_bytes:number;available_bytes:number|null;usage_percentage:number|null;breakdown:{published:number;drafts_unpublished:number;recoverable:number};category?:string;default_limit_bytes?:number|null;inventory:{product_files:number;profile_files:number;conversation_files:number;quarantined_files:number}}
export interface StorageQuotaSettings{defaults:{role:string;limit_bytes:number|null;revision:number}[];accounts:{id:number;username:string;display_name:string|null;role:string;verified_creator:boolean;summary:ProductStorageSummary;limit_bytes:number|null;revision:number|null}[]}
@Injectable({providedIn:'root'})
export class Api{
 reportPromotion(id:string,reason:string){return this.http.post('/api/feed-publications/'+encodeURIComponent(id)+'/reports',{reason});}
 reportProduct(id:number,reason:ReportReason){return this.http.post('/api/products/'+id+'/report',{reason});}
 private http=inject(HttpClient);private url=API_URL;private identities=inject(CreatorBadges);
 verificationStatus(){return this.http.get<VerificationStatus>(this.url+'/account/creator-verification');}
 applyForVerification(){return this.http.post<VerificationStatus>(this.url+'/account/creator-verification',{});}
 verificationQueue(status:VerificationQueue,before:number|null){
   return this.http.get<ReviewPage<VerificationEntry>>(this.url+'/admin/creator-verification',{params:{status,...(before?{before}:{})}});
 }
 verificationReview(id:number){return this.http.get<VerificationReview>(this.url+'/admin/creator-verification/'+id);}
 decideVerification(id:number,action:ReviewDecision,reason?:string){
   return this.http.put<VerificationStatus>(this.url+'/admin/creator-verification/'+id,{action,...(reason?{reason}:{})});
 }
 publicationReviews(before:number|null){
   return this.http.get<ReviewPage<PublicationReview>>(this.url+'/admin/product-publications',{params:before?{before}:{}});
 }
 decidePublication(id:number,decision:'approve'|'reject'){
   return this.http.put<void>(this.url+'/admin/product-publications/'+id,{decision});
 }
 comments(creatorId:number,postId:string,order:CommentOrder,cursor?:string){
   return this.http.get<CommentPage>(this.conversationPostUrl(creatorId,postId)+'/comments',{params:{order,...(cursor?{cursor}:{})}});
 }
 replies(creatorId:number,postId:string,root:string,cursor?:string){
   return this.http.get<CommentPage>(this.commentUrl(creatorId,postId,root)+'/replies',{params:cursor?{cursor}:{}});
 }
 commentContext(creatorId:number,postId:string,comment:string){
   return this.http.get<{items:SocialComment[]}>(this.commentUrl(creatorId,postId,comment));
 }
 createComment(creatorId:number,postId:string,body:string,reply_to:string|null,request_key:string){
   return this.http.post<SocialComment & {post_comment_count:number}>(this.conversationPostUrl(creatorId,postId)+'/comments',{body,reply_to,request_key});
 }
 updateComment(creatorId:number,postId:string,comment:string,body:string,revision:number){
   return this.http.put<SocialComment>(this.commentUrl(creatorId,postId,comment),{body,revision});
 }
 deleteComment(creatorId:number,postId:string,comment:string){
   return this.http.delete<void>(this.commentUrl(creatorId,postId,comment));
 }
 setReaction(creatorId:number,postId:string,comment:string|null,reaction:Reaction|null){
   const target=comment?this.commentUrl(creatorId,postId,comment):this.conversationPostUrl(creatorId,postId);
   return this.http.put<ReactionSummary>(target+'/reaction',{reaction});
 }
 conversationPoll(creatorId:number,postId:string){
   return this.http.get<ConversationPoll>(this.conversationPostUrl(creatorId,postId)+'/poll');
 }
 voteConversationPoll(creatorId:number,postId:string,position:number){
   return this.http.put<ConversationPoll>(this.conversationPostUrl(creatorId,postId)+'/poll/vote',{position});
 }
 closeConversationPoll(creatorId:number,postId:string){
   return this.http.put<ConversationPoll>(this.conversationPostUrl(creatorId,postId)+'/poll/close',{confirm:true});
 }
 reportConversation(creatorId:number,postId:string,reason:ReportReason,commentId?:string){
   const target=commentId?this.commentUrl(creatorId,postId,commentId):this.conversationPostUrl(creatorId,postId);
   return this.http.post<{submitted:true}>(target+'/report',{reason});
 }
 moderationCases(status:'pending'|'resolved',before:string|null,filters:{q?:string;type?:string}={}){
   return this.http.get<ModerationPage>(this.url+'/admin/conversation-moderation',{params:{status,...(before?{before}:{}),...filters}});
 }
 moderationCase(id:string){
   return this.http.get<ModerationCaseDetails>(this.url+'/admin/conversation-moderation/'+encodeURIComponent(id));
 }
 resolveModerationCase(id:string,action:'restore'|'remove',reason?:string){
   return this.http.put<ModerationCaseDetails>(this.url+'/admin/conversation-moderation/'+encodeURIComponent(id)+'/'+action,{confirm:true,...(reason?{reason}:{})});
 }
 private commentUrl(creatorId:number,postId:string,comment:string){
   return this.conversationPostUrl(creatorId,postId)+'/comments/'+encodeURIComponent(comment);
 }
 mentionCandidates(q:string){
   return this.http.get<{items:{id:number;username:string;display_name:string;verified_creator?:boolean}[]}>(this.url+'/account/mention-candidates',{params:{q}});
 }
 socialPreferences(){return this.http.get<SocialPreferences>(this.url+'/account/social-preferences');}
 updateSocialPreferences(key:'mention_visibility'|OptionalNotification,value:MentionVisibility|boolean){
   return this.http.put<SocialPreferences>(this.url+'/account/social-preferences',{[key]:value});
 }
 notifications(){return this.http.get<NotificationPage>(this.url+'/account/notifications');}
 notificationCount(){return this.http.get<{unread:number}>(this.url+'/account/notifications/count');}
 readNotifications(){return this.http.post<NotificationPage>(this.url+'/account/notifications/read',{});}
 dismissNotification(id:string){return this.http.delete<{dismissed_id:string}>(this.url+'/account/notifications/'+encodeURIComponent(id));}
 followCreator(id:number,follow:boolean){
   const url=this.url+'/creators/'+id+'/follow';
   return follow?this.http.put<FollowState>(url,{}):this.http.delete<FollowState>(url);
 }

 updatePassword(body:{current_password:string;new_password:string;confirm_password:string}){return this.http.put<{changed:true}>(this.url+'/account/password',body);}
 activity(filters:{tab:string;category:string;range:string;q:string},cursor?:string){return this.http.get<ActivityPage>(this.url+'/account/activity',{params:{...filters,...(cursor?{cursor}:{})}});}
 activityDetail(id:string){return this.http.get<AccountActivity>(this.url+'/account/activity/'+encodeURIComponent(id));}
 blockedUsers(page=1){return this.http.get<BlockPage<BlockedUser>>(this.url+'/account/blocks',{params:{page}}).pipe(map(r=>({...r,items:r.items.map(u=>({...u,avatar_url:assetUrl(u.avatar_url)}))})));}
 searchUsers(q:string,page=1){return this.http.get<BlockPage<BlockUser>>(this.url+'/account/users/search',{params:{q,page}}).pipe(map(r=>({...r,items:r.items.map(u=>({...u,avatar_url:assetUrl(u.avatar_url)}))})));}
 blockState(id:number){return this.http.get<BlockState>(this.url+'/account/blocks/'+id);}
 blockUser(id:number){return this.http.put<{user_id:number;blocked:boolean}>(this.url+'/account/blocks/'+id,{});}
 unblockUser(id:number){return this.http.delete<{user_id:number;blocked:boolean}>(this.url+'/account/blocks/'+id);}
 activeSessions(){return this.http.get<{sessions:ActiveSession[]}>(this.url+'/account/sessions');}
 revokeSession(id:string){return this.http.delete<void>(this.url+'/account/sessions/'+encodeURIComponent(id));}
 revokeAllSessions(){return this.http.post<void>(this.url+'/account/sessions/revoke-all',{});}
 updateDisplayName(body:{display_name:string;current_password:string;revision:number}){return this.http.put<AccountSettingsResult>(this.url+'/account/display-name',body);}
 updateEmail(body:{email:string;current_password:string;revision:number}){return this.http.put<AccountSettingsResult>(this.url+'/account/email',body);}
 updatePrivacy(body:{revision:number;followers_list?:'public'|'private';following_list?:'public'|'private'}){return this.http.put<AccountSettingsResult>(this.url+'/account/privacy',body);}
 resolveHandle(username:string){return this.http.get<{id:number;username:string}>(this.url+'/handles/'+encodeURIComponent(username));}
 accountSettings(){return this.http.get<AccountSettings>(this.url+'/account/settings');}
 catalog(page:number,category:number,q:string){return this.http.get<CatalogPage>(this.url+'/catalog',{params:{page,category,q}}).pipe(map(r=>({...r,items:r.items.map(normalize)})));}
 restoreVersion(id:number,versionId:number,revision:number,request_key:string){return this.http.post<{version_number?:number;version_id?:number;publication_pending?:boolean;review_id?:number}>(this.url+'/products/'+id+'/versions/'+versionId+'/restore',{revision,request_key});}
 downloadVersion(id:number,versionId:number){return this.http.get(this.url+'/products/'+id+'/versions/'+versionId+'/download',{responseType:'blob',observe:'response'});}
 reviewIdentity(id:string){return this.http.get<{username:string|null;stored_author:string|null}>(this.url+'/admin/reviews/'+encodeURIComponent(id)+'/identity');}
 products(){return this.http.get<Product[]>(this.url+'/products').pipe(map(p=>p.map(normalize)));}
 product(id:number){return this.http.get<Product>(`${this.url}/products/${id}`).pipe(map(normalize));}
 draft(id:number){return this.http.get<Product>(`${this.url}/products/${id}/draft`).pipe(map(normalize));}
 studioVerificationHistory(){return this.http.get<{items:StudioVerificationEntry[]}>(this.url+'/studio/verification-history');}
 temporaryActivity(ids:string[]){return this.http.post(this.url+'/assets/temporary/activity',{ids});}
 discardTemporary(ids:string[]){return this.http.post(this.url+'/assets/temporary/discard',{ids});}
 productStorage(){return this.http.get<ProductStorageSummary>(this.url+'/studio/storage');}
 storageQuotaSettings(){return this.http.get<StorageQuotaSettings>(this.url+'/admin/storage-quotas');}
 saveStorageQuota(scope:'role'|'account',target:string|number,body:{limit_bytes:number|null;revision:number;inherit:boolean}){return this.http.put(this.url+'/admin/storage-quotas/'+scope+'/'+target,body);}
 salesOverview(filters:SalesFilters){return this.http.get<SalesOverview>(this.url+'/studio/sales/overview',{params:{...filters}});}
 salesProducts(filters:SalesFilters,page:number){return this.http.get<SalesPage<SalesPerformance>>(this.url+'/studio/sales/products',{params:{...filters,page}});}
 salesVariants(product:number,filters:SalesFilters,page:number){return this.http.get<SalesPage<SalesPerformance>>(this.url+'/studio/sales/products/'+product+'/variants',{params:{...filters,page}});}
 salesHistory(filters:SalesFilters,page:number,kind:string){return this.http.get<SalesPage<SaleHistory>>(this.url+'/studio/sales/history',{params:{...filters,page,kind}});}
 salesProductOptions(){return this.http.get<{items:{product_id:number;product_name:string}[]}>(this.url+'/studio/sales/product-options');}
 studioAnalytics(){return this.http.get<StudioAnalytics>(this.url+'/studio/analytics');}
 studioCommunity(){return this.http.get<StudioCommunityData>(this.url+'/studio/community');}
 studioSummary(){return this.http.get<StudioSummary>(this.url+'/studio/summary');}
 myItems(all=false){return this.http.get<Product[]>(this.url+'/my-items'+(all?'?scope=all':'')).pipe(map(p=>p.map(normalize)));}
 versions(id:number){return this.http.get<PublishedVersion[]>(`${this.url}/products/${id}/versions`).pipe(map(v=>v.map(x=>({...x,snapshot:normalize(x.snapshot)}))));}
 discoverCreators(params:{q:string;sort:string;verified:string;page:number}){return this.http.get<CreatorDiscoveryPage>(this.url+'/creators/discover',{params});}
 creator(id:number){return this.http.get<CreatorProfile>(`${this.url}/creators/${id}`).pipe(map(normalizeCreator));}
 conversationPosts(creatorId: number, order: PostOrder, cursor: string | null) {
   return this.http.get<ConversationPage>(this.url + '/creators/' + creatorId + '/posts', {params: {order, ...(cursor ? {cursor} : {})}});
 }
 conversationPost(creatorId: number, postId: string) {
   return this.http.get<ConversationPost>(this.conversationPostUrl(creatorId, postId));
 }
 createConversationPost(creatorId: number, form: FormData) {
   return this.http.post<ConversationPost>(this.url + '/creators/' + creatorId + '/posts', form);
 }
 editConversationPost(creatorId:number,postId:string,body:{title:string;description:string;revision:number;poll_options?:string[]}) {
   return this.http.put<ConversationPost>(this.conversationPostUrl(creatorId, postId), body);
 }
 pinConversationPost(creatorId: number, postId: string, pinned: boolean) {
   return this.http.put<ConversationPost>(this.conversationPostUrl(creatorId, postId) + '/pin', {pinned});
 }
 deleteConversationPost(creatorId: number, postId: string) {
   return this.http.delete<{deletion_pending?:boolean}|null>(this.conversationPostUrl(creatorId, postId));
 }
 private conversationPostUrl(creatorId: number, postId: string) {
   return this.url + '/creators/' + creatorId + '/posts/' + encodeURIComponent(postId);
 }
 pinProfileItem(pinned_product_id:number|null,revision:number){return this.http.put<CreatorProfile>(this.url+'/profile/pin',{pinned_product_id,revision}).pipe(map(normalizeCreator));}
 saveProfile(body:FormData){return this.http.put<CreatorProfile>(this.url+'/profile',body).pipe(map(normalizeCreator),tap(profile=>this.identities.updateIdentity(profile)));}
 profileOriginal(id:string){return this.http.get(this.url+'/profile-media/'+id+'/original',{responseType:'blob'});}
 imageBlob(url:string){return this.http.get(url,{responseType:'blob'});}
 robloxAvatar(query:string){return this.http.post<{token:string;id:number;username:string;display_name:string;preview_url:string}>(this.url+'/profile/roblox',{query});}
 categories(){return this.http.get<Category[]>(this.url+'/categories');}
 create(body:unknown){return this.http.post<Product>(this.url+'/products',body).pipe(map(normalize));}
 update(id:number,body:unknown){return this.http.put<Product>(`${this.url}/products/${id}`,body).pipe(map(normalize));}
 publish(id:number,revision:number){return this.http.post<Product>(`${this.url}/products/${id}/publish`,{revision});}
 state(id:number,state:string){return this.http.post<Product>(`${this.url}/products/${id}/state`,{state});}
 remove(id:number){return this.http.delete<void>(`${this.url}/products/${id}`);}
 upload(kind:string,file:File){return this.http.post<{id:string;preview_url:string;compatible?:boolean}>(`${this.url}/assets/${kind}`,file,{headers:{'Content-Type':'application/octet-stream'}});}
 reportReview(id:string,reason:ReportReason,description:string){return this.http.post('/api/reviews/'+encodeURIComponent(id)+'/report',{reason,description});}
 updateReview(id:string,body:{rating:number;comment:string;revision:number}){return this.http.put<Review>('/api/reviews/'+encodeURIComponent(id),body);}
 deleteReview(id:string){return this.http.delete<void>('/api/reviews/'+encodeURIComponent(id),{body:{confirm:true}});}
 reviews(id:number){return this.http.get<Review[]>(`${this.url}/reviews?product_id=${id}`);}
 review(body:{product_id:number;is_anonymous:boolean;rating:number;comment:string},requestKey:string=crypto.randomUUID()){return this.http.post<Review>(this.url+'/reviews',body,{headers:{'Idempotency-Key':requestKey}});}
}
export function errorMessage(error:unknown):string{if(error instanceof HttpErrorResponse){if(error.status===0)return 'Could not connect to the store. Check that the backend is running and try again.';return error.error?.error||'Could not complete the request. Please try again.';}return 'An error occurred. Please try again.';}
