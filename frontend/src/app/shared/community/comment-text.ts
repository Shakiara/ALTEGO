// ALTEGO necesita resolver la presentación segura del texto y las menciones.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {AccountBadges} from "../identity/account-badges";
import {Component,ElementRef,computed,effect,input,signal,viewChild} from '@angular/core';
import {RouterLink} from '@angular/router';
import {SocialComment} from "../social/social-types";

const dateFormat=new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric'});
export function hybridTime(timestamp:string){
  const date=new Date(timestamp),minutes=Math.max(0,Math.floor((Date.now()-date.valueOf())/60000));
  if(!Number.isFinite(minutes))return '';
  if(minutes<60)return minutes+'m';
  if(minutes<1440)return Math.floor(minutes/60)+'h';
  if(minutes<10080)return Math.floor(minutes/1440)+'d';
  return dateFormat.format(date);
}
@Component({
  selector:'app-comment-text',imports:[AccountBadges,RouterLink],
  template:`<p #copy [class.collapsed]="!expanded()">@for(part of pieces();track $index){@if(part.user){<a [routerLink]="['/creators',part.user]">{{part.text}} <app-account-badges [creatorId]="part.user" [verified]="part.verified ?? false"/></a>}@else{<ng-container>{{part.text}}</ng-container>}}</p>
  @if(long()){<button type="button" [attr.aria-expanded]="expanded()" (click)="expanded.update(value=>!value)">{{expanded()?'Show less':'Show more'}}</button>}`,
  styles:`:host{display:block;min-width:0}p{margin:2px 0;white-space:pre-wrap;overflow-wrap:anywhere;font-size:14px;line-height:1.55}
  .collapsed{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden}
  button{background:none;border:0;padding:3px 0;color:var(--conversation-control);cursor:pointer}a{color:var(--conversation-control);font-weight:600}`,
})
export class CommentText {
  comment=input.required<SocialComment>();
  expanded=signal(false);
  long=signal(false);
  private copy=viewChild<ElementRef<HTMLParagraphElement>>('copy');
  pieces=computed(()=>{
    const {body,mentions}=this.comment(),parts:{text:string;user?:number;verified?:boolean}[]=[];
    let position=0;
    for(const entry of mentions){
      if(entry.start<position||entry.end>body.length||entry.start>=entry.end)continue;
      if(position<entry.start)parts.push({text:body.slice(position,entry.start)});
      parts.push({text:body.slice(entry.start,entry.end),user:entry.user_id,verified:entry.verified_creator});position=entry.end;
    }
    if(position<body.length)parts.push({text:body.slice(position)});
    return parts;
  });
  constructor(){
    effect(cleanup=>{
      this.comment().body;
      const node=this.copy()?.nativeElement;if(!node)return;
      const measure=()=>this.long.set(node.scrollHeight>parseFloat(getComputedStyle(node).lineHeight)*3+1);
      const observer=new ResizeObserver(measure);observer.observe(node);cleanup(()=>observer.disconnect());measure();
    });
  }
}
