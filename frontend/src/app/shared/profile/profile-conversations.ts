// ALTEGO necesita resolver las publicaciones visibles en el perfil.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {CreatorBadges} from "../identity/verified-creator-badge";
import {ConversationPollCard} from "../community/conversation-poll";
import {ConversationReport} from "../community/conversation-report";
import type {ConversationPoll} from "../community/community-types";
import {ConversationThread} from "../community/conversation-thread";
import {SocialReactions} from "../social/social-reactions";
import type {PostEngagement,ReactionSummary} from "../social/social-types";
import {afterNextRender, Component, computed, effect, ElementRef, inject, Injector, input, OnDestroy, output, signal, untracked, ViewChild} from '@angular/core';
import {toSignal} from '@angular/core/rxjs-interop';
import {NgTemplateOutlet} from '@angular/common';
import {ActivatedRoute, Router} from '@angular/router';
import {firstValueFrom, map} from 'rxjs';
import {Api, errorMessage} from "../../core/http/api";
import type {ConversationPost, CreatorProfile, PostOrder} from "../../core/http/api";
import {AuthService} from "../../core/auth/auth-service";
import {ConversationImageCarousel} from "../community/conversation-image-carousel";
import {ConversationImageSelection, ConversationPostAction, ConversationPostCard} from "../community/conversation-post-card";
import {Icon} from "../ui/icon";
import {UiFeedback} from "../ui/ui-feedback";
import {GlassPanel, VisualButton, VisualField, VisualModal} from "../ui/visual-primitives";

type ImageChoice = {file: File; url: string};
const supportedImages = new Set(['image/png', 'image/jpeg', 'image/webp']);

@Component({
  selector: 'app-profile-conversations',
  imports: [NgTemplateOutlet, ConversationPollCard, ConversationReport, ConversationThread, SocialReactions, ConversationPostCard, ConversationImageCarousel, GlassPanel, Icon, VisualButton, VisualField, VisualModal],
  templateUrl: './profile-conversations.html',
  styleUrl: './profile-conversations.css',
})
export class ProfileConversations implements OnDestroy {
  profile = input.required<CreatorProfile>();
  management=input(false);editorClosed=output<void>();
  private readonly api = inject(Api);
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly ui = inject(UiFeedback);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly owner = computed(() => this.auth.user()?.id === this.profile().id);
  readonly communityAvailable = signal(false);
  readonly communityEnabled = computed(() => this.detail()?.community_available ?? this.communityAvailable());
  readonly mayReport = computed(() => this.communityEnabled() && !this.auth.loading() && !this.owner());
  private readonly reportedTargets = signal<ReadonlySet<string>>(new Set());
  readonly pollDurations = [{value:'1',label:'1 day'},{value:'3',label:'3 days'},{value:'7',label:'7 days'},{value:'custom',label:'Custom'}];
  readonly editablePoll = computed(() => {
    const poll = this.editing()?.poll;
    return Boolean(poll && !poll.closed && !poll.locked);
  });
  readonly admin = computed(() => this.auth.user()?.role === 'admin');
  private readonly badges = inject(CreatorBadges);
  readonly maxImages = computed(() => (this.badges.read(this.profile().id) ?? this.profile().verified_creator) ? 8 : 4);
  readonly postId = toSignal(this.route.queryParamMap.pipe(map(params => params.get('post'))), {
    initialValue: this.route.snapshot.queryParamMap.get('post'),
  });
  readonly order = signal<PostOrder>('newest');
  readonly sortOptions = [
    {value:'newest', label:'Newest', icon:'arrow-down', available:true},
    {value:'oldest', label:'Oldest', icon:'arrow-up', available:true},
    {value:'popular', label:'Most Popular', icon:'star', available:false},
  ] as const;
  readonly now = signal(Date.now());
  readonly copiedPost = signal<string | null>(null);
  readonly posts = signal<ConversationPost[]>([]);
  readonly pinned = signal<ConversationPost | null>(null);
  readonly feed = computed(() => {
    const pinned = this.pinned();
    return pinned ? [pinned, ...this.posts().filter(post => post.id !== pinned.id)] : this.posts();
  });
  readonly nextCursor = signal<string | null>(null);
  readonly feedLoading = signal(false);
  readonly feedError = signal('');
  readonly detail = signal<ConversationPost | null>(null);
  readonly detailLoading = signal(false);
  readonly detailError = signal('');
  readonly missing = signal(false);
  readonly busy = signal(false);
  readonly editing = signal<ConversationPost | null>(null);
  readonly title = signal('');
  readonly description = signal('');
  readonly addPoll = signal(false);
  readonly pollOptions = signal(['','']);
  readonly pollDuration = signal('1');
  readonly pollDays = signal(1);
  readonly images = signal<ImageChoice[]>([]);
  readonly formError = signal('');
  readonly imageError = signal('');
  readonly saving = signal(false);
  readonly confirmPending = signal(false);
  readonly gallery = signal<ConversationPost | null>(null);
  readonly galleryIndex = signal(0);
  @ViewChild(ConversationReport) private report?: ConversationReport;
  @ViewChild('composer') private composer?: ElementRef<HTMLDialogElement>;
  @ViewChild('imageViewer') private imageViewer?: ElementRef<HTMLDialogElement>;


  private readonly clock = setInterval(() => this.now.set(Date.now()), 15_000);
  private copiedTimer?: ReturnType<typeof setTimeout>;
  private galleryReturn?: {trigger: HTMLElement; top: number};
  private feedLoaded = false;
  private feedRequest = 0;
  private detailRequest = 0;
  private disposed = false;
  private previousPost: string | null = null;
  private feedScroll?: number;
  private draftActor?: number;
  private requestKey?: string;
  private scrollState?: {element: HTMLElement; value: string};

  constructor() {
    effect(() => {
      const profileId = this.profile().id;
      const postId = this.postId();
      untracked(() => this.showRoute(profileId, postId));
    });
  }

  private showRoute(profileId: number, postId: string | null) {
    const previous = this.previousPost;
    this.previousPost = postId;
    if (postId !== null) {
      if (!previous && this.feedLoaded) this.feedScroll = window.scrollY;
      void this.loadDetail(profileId, postId);
      afterNextRender(() => {
        if (this.disposed || this.postId() !== postId) return;
        const heading = this.host.nativeElement.querySelector<HTMLElement>('[data-post-heading]');
        heading?.focus({preventScroll: true});
        heading?.scrollIntoView({block: 'start', behavior: 'instant'});
      }, {injector: this.injector});
      return;
    }
    ++this.detailRequest;
    this.detail.set(null);
    this.detailLoading.set(false);
    if (!this.feedLoaded && !this.feedLoading()) void this.loadFeed();
    if (previous && this.feedScroll !== undefined) {
      const top = this.feedScroll;
      this.feedScroll = undefined;
      afterNextRender(() => {
        if (this.disposed || this.postId() !== null) return;
        const card = Array.from(this.host.nativeElement.querySelectorAll<HTMLElement>('[data-post-id]'))
          .find(node => node.dataset['postId'] === previous);
        card?.querySelector<HTMLElement>('.title')?.focus({preventScroll: true});
        window.scrollTo({top, behavior: 'instant'});
      }, {injector: this.injector});
    }
  }

  async loadFeed(append = false) {
    const cursor = append ? this.nextCursor() : null;
    if (append && (!cursor || this.feedLoading())) return;
    const request = ++this.feedRequest;
    const profileId = this.profile().id;
    this.feedLoading.set(true);
    this.feedError.set('');
    try {
      const page = await firstValueFrom(this.api.conversationPosts(profileId, this.order(), cursor));
      if (this.disposed || request !== this.feedRequest) return;
      this.pinned.set(page.pinned);
      this.communityAvailable.set(page.community_available===true);
      const merged = [...(append ? this.posts() : []), ...page.items];
      this.posts.set([...new Map(merged.map(post => [post.id, post])).values()]);
      this.nextCursor.set(page.next_cursor);
      this.feedLoaded = true;
    } catch (error) {
      if (this.disposed || request !== this.feedRequest) return;
      if (append && (error as {error?: {code?: string}})?.error?.code === 'POST_FEED_CHANGED') {
        await this.loadFeed();
      } else {
        this.feedError.set(errorMessage(error));
      }
    } finally {
      if (!this.disposed && request === this.feedRequest) this.feedLoading.set(false);
    }
  }

  changeOrder(value: string) {
    if ((value !== 'newest' && value !== 'oldest') || value === this.order()) return;
    this.order.set(value);
    this.pinned.set(null);
    this.posts.set([]);
    this.nextCursor.set(null);
    this.feedLoaded = false;
    void this.loadFeed();
  }

  async loadDetail(profileId = this.profile().id, postId = this.postId()) {
    if (postId === null) return;
    const request = ++this.detailRequest;
    this.detail.set(null);
    this.detailError.set('');
    this.missing.set(false);
    this.detailLoading.set(true);
    try {
      const post = await firstValueFrom(this.api.conversationPost(profileId, postId));
      if (!this.disposed && request === this.detailRequest) this.detail.set(post);
    } catch (error) {
      if (this.disposed || request !== this.detailRequest) return;
      if ((error as {status?: number}).status === 404) this.missing.set(true);
      else this.detailError.set(errorMessage(error));
    } finally {
      if (!this.disposed && request === this.detailRequest) this.detailLoading.set(false);
    }
  }

  back() { void this.go(null); }

  private go(postId: string | null) {
    return this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {section: 'conversations', post: postId, comment:null},
      queryParamsHandling: 'merge',
    });
  }

  async action(action: ConversationPostAction, post: ConversationPost) {
    if (action === 'open') { await this.go(post.id); return; }
    if (action === 'copy') {
      const path = this.router.serializeUrl(this.router.createUrlTree(['/creators', post.author.id], {
        queryParams: {section: 'conversations', post: post.id},
      }));
      try {
        await navigator.clipboard.writeText(new URL(path, window.location.origin).href);
        if (this.disposed) return;
        this.copiedPost.set(post.id);
        clearTimeout(this.copiedTimer);
        this.copiedTimer = setTimeout(() => this.copiedPost.set(null), 1800);
      } catch {
        this.ui.notify('Could not copy the link.', 'error');
      }
      return;
    }
    if (action === 'report') { this.openReport(post.id); return; }
    if (this.busy() || this.saving()) return;
    if (action === 'edit') { this.openComposer(post); return; }
    if (action === 'pin' && !this.owner()) return;
    if (action === 'delete' && !this.owner()) return;

    this.busy.set(true);
    try {
      if (action === 'delete') {
        const confirmed = await this.ui.confirm({title: 'Delete post?', description: 'This permanently removes the post and its images.', danger: true, confirmLabel: 'Delete Post'});
        if (!confirmed || this.disposed || !this.owner()) return;
        const deletion=await firstValueFrom(this.api.deleteConversationPost(this.profile().id, post.id));
        if (this.disposed) return;
        this.posts.update(posts => posts.filter(item => item.id !== post.id));
        if (this.pinned()?.id === post.id) this.pinned.set(null);
        if (this.postId() === post.id) await this.go(null);
        this.ui.notify(deletion?.deletion_pending?'Post removed. Image cleanup is still pending.':'Post deleted.',deletion?.deletion_pending?'info':'success');
        if (!this.feed().length) await this.loadFeed();
      } else {
        const saved = await firstValueFrom(this.api.pinConversationPost(this.profile().id, post.id, !post.pinned));
        if (this.disposed) return;
        this.applyPost(saved);
        this.ui.notify(saved.pinned ? 'Post pinned.' : 'Post unpinned.');
        await this.loadFeed();
      }
    } catch (error) {
      if (!this.disposed) this.ui.notify(errorMessage(error), 'error');
    } finally {
      this.busy.set(false);
    }
  }

  openComposer(post: ConversationPost | null = null) {
    const dialog = this.composer?.nativeElement;
    if (!this.owner() || !dialog || dialog.open || this.busy()) return;
    this.editing.set(post);
    this.title.set(post?.title ?? '');
    this.description.set(post?.description ?? '');
    this.addPoll.set(false);
    this.pollOptions.set(post?.poll?.options.map(option=>option.label) ?? ['','']);
    this.pollDuration.set('1');
    this.pollDays.set(1);
    this.clearImages();
    this.formError.set('');
    this.imageError.set('');
    this.draftActor = this.auth.user()?.id;
    this.requestKey = undefined;
    this.openDialog(dialog);
  }

  updateText(field: 'title' | 'description', value: string) {
    this[field].set(value);
    this.requestKey = undefined;
    this.formError.set('');
  }

  changePoll(change:()=>void) {
    change();
    this.requestKey=undefined;
    this.formError.set('');
  }

  togglePoll(value:boolean){this.changePoll(()=>this.addPoll.set(value));}
  pollToggleFocus(){
    this.composer?.nativeElement.querySelector<HTMLButtonElement>('.poll-toggle')?.focus({preventScroll:true});
  }
  setPollDuration(value:string){this.changePoll(()=>this.pollDuration.set(value));}
  setPollDays(value:number){this.changePoll(()=>this.pollDays.set(value));}
  appendPollOption(){
    const index=this.pollOptions().length;
    if (index>=6) return;
    this.changePoll(()=>this.pollOptions.update(options=>[...options,'']));
    this.focusPollOption(index);
  }

  removePollOption(index:number){
    if (this.pollOptions().length<=2) return;
    this.changePoll(()=>this.pollOptions.update(options=>options.filter((_,i)=>i!==index)));
    this.focusPollOption(Math.min(index,this.pollOptions().length-1));
  }

  private focusPollOption(index:number) {
    afterNextRender(()=>{
      this.composer?.nativeElement.querySelectorAll<HTMLInputElement>('.poll-option-field input')[index]?.focus();
    },{injector:this.injector});
  }

  changePollOption(index:number,value:string) {
    this.changePoll(()=>this.pollOptions.update(options=>options.map((option,i)=>i===index?value:option)));
  }

  canReportPost(postId:string) {
    return this.mayReport() && !this.reportedTargets().has(this.reportKey(this.auth.user()?.id,postId));
  }

  private reportKey(reporterId:number|undefined,postId:string,commentId?:string) {
    return [reporterId,postId,commentId].join(':');
  }

  markReported(target:{reporterId:number;postId:string;commentId?:string}) {
    this.reportedTargets.update(targets=>new Set([...targets,this.reportKey(target.reporterId,target.postId,target.commentId)]));
  }

  openReport(postId:string,commentId?:string) {
    if (!this.communityEnabled() || (!commentId && !this.canReportPost(postId))) return;
    const reporterId=this.auth.user()?.id;
    if (!reporterId) {
      void this.router.navigate(['/login'],{queryParams:{returnUrl:this.router.url}});
      return;
    }
    if (this.reportedTargets().has(this.reportKey(reporterId,postId,commentId))) {
      this.ui.notify('Report already submitted.');
      return;
    }
    this.report?.open({creatorId:this.profile().id,postId,commentId,reporterId});
  }

  updatePoll(id:string,poll:ConversationPoll) {
    this.updatePost(id,post=>({...post,poll}));
  }

  chooseImages(input: HTMLInputElement) {
    const added = Array.from(input.files ?? []);
    input.value = '';
    if (!added.length || this.editing() || this.saving()) return;
    if (this.images().length + added.length > this.maxImages()) {
      this.imageError.set('Choose up to ' + this.maxImages() + ' images.');
      return;
    }
    if (added.some(file => !supportedImages.has(file.type) || !file.size || file.size > 4 * 1024 * 1024)) {
      this.imageError.set('Choose PNG, JPEG or WebP images up to 4 MB each.');
      return;
    }
    this.images.update(images => [...images, ...added.map(file => ({file, url: URL.createObjectURL(file)}))]);
    this.imageError.set('');
    this.formError.set('');
    this.requestKey = undefined;
  }

  removeImage(index: number) {
    const image = this.images()[index];
    if (!image || this.saving()) return;
    URL.revokeObjectURL(image.url);
    this.images.update(images => images.filter((_, i) => i !== index));
    this.imageError.set('');
    this.requestKey = undefined;
  }

  hasDraft() {
    if (!this.composer?.nativeElement.open) return false;
    const initial = this.editing();
    return this.saving() || this.title() !== (initial?.title ?? '') ||
      this.description() !== (initial?.description ?? '') || this.images().length > 0 || this.addPoll() ||
      (!initial && (this.pollOptions().some(option=>option.trim()) || this.pollOptions().length>2 || this.pollDuration()!=='1')) ||
      Boolean(initial?.poll && this.pollOptionsChanged(initial.poll));
  }

  async closeComposer(event?: Event): Promise<boolean> {
    event?.preventDefault();
    if (!this.composer?.nativeElement.open) return true;
    if (this.saving() || this.confirmPending()) return false;
    if (this.hasDraft()) {
      this.confirmPending.set(true);
      const discard = await this.ui.confirm({title: 'Discard changes?', description: 'Your unpublished changes will be lost.', danger: true, confirmLabel: 'Discard'});
      this.confirmPending.set(false);
      if (!discard) return false;
    }
    this.finishComposer();
    return true;
  }

  private pollOptionsChanged(poll:ConversationPoll) {
    const options=this.pollOptions();
    return options.length!==poll.options.length || options.some((option,index)=>option!==poll.options[index].label);
  }

  async submit(event: Event) {
    event.preventDefault();
    if (this.saving() || this.confirmPending() || !this.owner() || this.draftActor !== this.auth.user()?.id) return;
    const title = this.title(), description = this.description(), post = this.editing();
    const images = this.images();
    if (!title.trim() || title.length > 100 || description.length > 2000) {
      this.formError.set('Enter a title up to 100 characters and a description up to 2,000 characters.');
      return;
    }
    if (!description.trim() && !(post?.images.length || images.length || post?.poll || this.addPoll())) {
      this.formError.set('Add a description, an image or a poll.');
      return;
    }
    if (images.length > this.maxImages()) {
      this.formError.set('Choose up to ' + this.maxImages() + ' images.');
      return;
    }
    const days=this.pollDuration()==='custom'?this.pollDays():Number(this.pollDuration());
    if (this.addPoll() || (post?.poll && this.pollOptionsChanged(post.poll))) {
      const options=this.pollOptions().map(option=>option.normalize('NFKC').trim().replace(/\s+/gu,' '));
      if (options.length<2 || options.length>6 || options.some(option=>!option || Array.from(option).length>100)) {
        this.formError.set('Enter 2 to 6 poll options of up to 100 characters each.');
        return;
      }
      if (new Set(options.map(option=>option.toLowerCase())).size!==options.length) {
        this.formError.set('Poll options must be different.');
        return;
      }
      if (this.addPoll() && (!Number.isInteger(days) || days<1 || days>30)) {
        this.formError.set('Choose a poll duration from 1 to 30 days.');
        return;
      }
    }
    this.saving.set(true);
    this.formError.set('');
    try {
      const profileId = this.profile().id;
      let saved: ConversationPost;
      if (post) {
        const poll_options=post.poll && this.pollOptionsChanged(post.poll) ? this.pollOptions() : undefined;
        saved = await firstValueFrom(this.api.editConversationPost(profileId,post.id,{title,description,revision:post.revision,poll_options}));
      } else {
        const form = new FormData();
        this.requestKey ??= crypto.randomUUID();
        form.set('request_key', this.requestKey);
        form.set('title', title);
        form.set('description', description);
        if (this.addPoll()) {
          form.set('poll',JSON.stringify({options:this.pollOptions(),days}));
        }
        for (const image of images) form.append('images', image.file);
        saved = await firstValueFrom(this.api.createConversationPost(profileId, form));
      }
      if (this.disposed) return;
      this.finishComposer();
      this.ui.notify(post ? 'Post updated.' : 'Post published.');
      if (post) this.applyPost(saved);
      else await this.loadFeed();
    } catch (error) {
      if (!this.disposed) this.formError.set(errorMessage(error));
    } finally {
      this.saving.set(false);
    }
  }

  private applyPost(saved: ConversationPost) {
    this.updatePost(saved.id,post=>({...post,...saved}));
    if(this.postId()===saved.id&&!this.detail())this.detail.set(saved);
  }

  private updatePost(id:string,update:(post:ConversationPost)=>ConversationPost) {
    this.posts.update(posts=>posts.map(post=>post.id===id?update(post):post));
    this.pinned.update(post=>post?.id===id?update(post):post);
    this.detail.update(post=>post?.id===id?update(post):post);
  }

  private updateEngagement(id:string,update:(state:PostEngagement)=>PostEngagement){
    this.updatePost(id,post=>post.engagement?{...post,engagement:update(post.engagement)}:post);
  }

  reactionChanged(id:string,value:ReactionSummary){this.updateEngagement(id,state=>({...state,...value}));}
  commentCountChanged(id:string,total:number){this.updateEngagement(id,state=>({...state,comment_count:total}));}

  async openComments(post:ConversationPost){
    if(this.postId()!==post.id){
      await this.router.navigate([], {relativeTo:this.route,queryParams:{section:'conversations',post:post.id,comment:null},
        fragment:'conversation-comments',queryParamsHandling:'merge'});
      return;
    }
    this.focusComments();
  }

  focusComments(){
    const thread=this.host.nativeElement.querySelector<HTMLElement>('#conversation-comments');
    thread?.scrollIntoView({block:'start'});
    thread?.querySelector<HTMLElement>('h2')?.focus({preventScroll:true});
  }

  openGallery(post: ConversationPost, {index, trigger}: ConversationImageSelection) {
    const dialog = this.imageViewer?.nativeElement;
    if (!dialog || dialog.open || !post.images[index]) return;
    this.galleryReturn = {trigger, top: window.scrollY};
    this.galleryIndex.set(index);
    this.gallery.set(post);
    this.openDialog(dialog);
  }

  galleryKey(event: KeyboardEvent) {
    const total = this.gallery()?.images.length ?? 0;
    if (total < 2 || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
    event.preventDefault();
    const direction = event.key === 'ArrowLeft' ? -1 : 1;
    this.galleryIndex.update(index => (index + direction + total) % total);
  }

  closeGallery(event?: Event) {
    event?.preventDefault();
    this.imageViewer?.nativeElement.close();
    this.gallery.set(null);
    this.unlockScroll();
    const previous = this.galleryReturn;
    this.galleryReturn = undefined;
    if (previous) {
      previous.trigger.focus({preventScroll: true});
      window.scrollTo({top: previous.top, behavior: 'instant'});
    }
  }

  backdrop(event: MouseEvent, dialog: HTMLDialogElement, target: 'composer' | 'gallery') {
    if (event.target !== dialog) return;
    const {left, right, top, bottom} = dialog.getBoundingClientRect();
    if (event.clientX >= left && event.clientX <= right && event.clientY >= top && event.clientY <= bottom) return;
    if (target === 'composer') void this.closeComposer();
    else this.closeGallery();
  }

  private openDialog(dialog: HTMLDialogElement) {
    dialog.showModal();
    const element = dialog.ownerDocument.documentElement;
    this.scrollState = {element, value: element.style.overflow};
    element.style.overflow = 'hidden';
  }

  private finishComposer() {
    this.composer?.nativeElement.close();
    if(!this.disposed)this.editorClosed.emit();
    this.unlockScroll();
    this.clearImages();
  }

  private clearImages() {
    for (const image of this.images()) URL.revokeObjectURL(image.url);
    this.images.set([]);
  }

  private unlockScroll() {
    if (!this.scrollState) return;
    this.scrollState.element.style.overflow = this.scrollState.value;
    this.scrollState = undefined;
  }

  ngOnDestroy() {
    this.disposed = true;
    clearInterval(this.clock);
    clearTimeout(this.copiedTimer);
    this.unlockScroll();
    this.clearImages();
  }
}
