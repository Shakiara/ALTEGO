// ALTEGO necesita resolver la carga e interacción con los modelos 3D.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {Icon} from "../ui/icon";
import {HttpClient} from '@angular/common/http';
import {firstValueFrom} from 'rxjs';
import { Component, CUSTOM_ELEMENTS_SCHEMA, input, signal, OnDestroy, effect, viewChild, ElementRef, inject, output } from '@angular/core';
import '@google/model-viewer';
import type {ModelViewerElement} from '@google/model-viewer';
@Component({
  selector: 'app-model', imports:[Icon], schemas: [CUSTOM_ELEMENTS_SCHEMA],
  host: { '(mouseenter)': 'setHover(true)', '(mouseleave)': 'setHover(false)', '(focusin)': 'setHover(true)', '(focusout)': 'setHover(false)' },
  template: `
    @if (src(); as model) {
      @if (!failed()) {
        <model-viewer #viewer with-credentials [attr.src]="model" [attr.alt]="name()" camera-controls touch-action="pan-y"
          [attr.auto-rotate]="autoRotation() && hover() && !reduced() && (!returnOnHoverEnd() || loaded()) ? '' : null" auto-rotate-delay="0" rotation-per-second="28deg"
          camera-orbit="0deg 80deg auto" shadow-intensity="0.7" exposure="1" environment-image="neutral"
          loading="lazy" reveal="auto" interaction-prompt="none" (camera-change)="captureCamera()" (load)="onLoad()" (error)="onError()">
          <div slot="progress-bar" class="model-loading" [hidden]="loaded()">Preparing 3D preview…</div>
        </model-viewer>
      } @else { <div class="model-empty"><app-icon class="model-empty-icon" name="cube"/>The model could not be loaded.<button type="button" (click)="retry()">Try again</button></div> }
    } @else { <div class="model-empty"><app-icon class="model-empty-icon" name="cube"/>3D preview coming soon</div> }
    @if(textureLoading()){<p role="status" class="field-help">Applying texture…</p>}
    @if(textureError()){<p class="notice error" role="alert">{{textureError()}}</p>}
  `
})
export class Model implements OnDestroy {
  private http=inject(HttpClient);
  previewReady=output<boolean>();
  textureLoading=signal(false);
  texture=input<string|null>(null);
  neutral=input(false);
  captureView=input(false);autoRotation=input(true);animationPlayback=input(true);initialCamera=input<string|null>(null);cameraChanged=output<string>();private restoringCamera=false;
  textureError=signal('');
  viewer=viewChild<ElementRef>('viewer');
  private textureRequest=0;
  private originalTextures:any[]=[];
  private originalFactors:any[]=[];
  private textureCache=new Map<string,any>();
  async applyTexture(){const element=this.viewer()?.nativeElement;if(!element?.model||!this.loaded())return;const request=++this.textureRequest;this.previewReady.emit(false);this.textureLoading.set(true);this.textureError.set('');try{const url=this.texture();let texture=url?this.textureCache.get(url):null;if(url&&!texture){                                                                                        
const blob=await firstValueFrom(this.http.get(url,{responseType:'blob',withCredentials:true}));const objectUrl=URL.createObjectURL(blob);try{texture=await element.createTexture(objectUrl);}finally{URL.revokeObjectURL(objectUrl);}if(!texture)throw Error('Texture decoding failed.');this.textureCache.set(url,texture);}if(request!==this.textureRequest)return;element.model.materials.forEach((material:any,i:number)=>{material.pbrMetallicRoughness.baseColorTexture.setTexture(url?texture:this.neutral()?null:this.originalTextures[i]);material.pbrMetallicRoughness.setBaseColorFactor(url?[1,1,1,1]:this.neutral()?[0.82,0.79,0.82,1]:this.originalFactors[i]);});this.previewReady.emit(true);}catch(error){console.warn('Texture application failed:',error instanceof Error?error.message:'Unknown texture error');if(request===this.textureRequest)this.textureError.set('Texture could not be applied. Check the PNG and model UV layout.');}finally{if(request===this.textureRequest)this.textureLoading.set(false);}}
  onLoad(){const element=this.viewer()?.nativeElement;this.cancelReturn();this.restAngle=this.returnOnHoverEnd()?element?.turntableRotation:undefined;this.originalTextures=element?.model?.materials.map((m:any)=>m.pbrMetallicRoughness.baseColorTexture.texture)||[];this.originalFactors=element?.model?.materials.map((m:any)=>[...m.pbrMetallicRoughness.baseColorFactor])||[];this.loaded.set(true);if(!this.animationPlayback())element?.pause();if(this.initialCamera()&&element){this.restoringCamera=true;element.cameraOrbit=this.initialCamera();void element.updateComplete.then(()=>{if(this.viewer()?.nativeElement===element){element.jumpCameraToGoal();this.restoringCamera=false;this.captureCamera();}});}void this.applyTexture();}
  src = input<string | null>(null);
  name = input('3D item');
  detail = input(false);
  returnOnHoverEnd = input(false);
  hover = signal(false);
  loaded = signal(false);
  failed = signal(false);
  private media = matchMedia('(prefers-reduced-motion: reduce)');
  reduced = signal(this.media.matches);
  private restAngle?: number;
  private returnFrame?: number;

  private changed = (event: MediaQueryListEvent) => {
    this.reduced.set(event.matches);
    const element: ModelViewerElement | undefined = this.viewer()?.nativeElement;
    if (!event.matches || !this.returnOnHoverEnd() || !element || this.restAngle === undefined) return;
    this.cancelReturn();
    element.autoRotate = false;
    element.resetTurntableRotation(this.restAngle);
  };

  setHover(active: boolean) {
    if (active === this.hover()) return;
    this.hover.set(active);
    if (!this.returnOnHoverEnd()) return;
    this.cancelReturn();

    const element: ModelViewerElement | undefined = this.viewer()?.nativeElement;
    const rest = this.restAngle;
    if (!element || rest === undefined || !this.loaded()) return;


    element.autoRotate = this.autoRotation() && active && !this.reduced();
    if (active || this.reduced()) return;
    const from = element.turntableRotation;
    const difference = rest - from;
    const arc = Math.atan2(Math.sin(difference), Math.cos(difference));
    if (Math.abs(arc) < 0.00001) return;
    const start = performance.now();
    const frame = (now: number) => {
      const progress = Math.min((now - start) / 700, 1);
      const eased = 1 - (1 - progress) ** 3;
      element.resetTurntableRotation(progress === 1 ? rest : from + arc * eased);
      this.returnFrame = progress < 1 ? requestAnimationFrame(frame) : undefined;
    };
    this.returnFrame = requestAnimationFrame(frame);
  }

  private cancelReturn() {
    if (this.returnFrame === undefined) return;
    cancelAnimationFrame(this.returnFrame);
    this.returnFrame = undefined;
  }
  constructor() { this.media.addEventListener('change', this.changed);effect(()=>{this.src();this.cancelReturn();this.restAngle=undefined;this.previewReady.emit(false);this.loaded.set(false);this.failed.set(false);this.textureCache.clear();this.textureRequest++;});effect(()=>{this.texture();this.neutral();this.loaded();void this.applyTexture();}); }
  captureCamera(){const element=this.viewer()?.nativeElement;if(!this.captureView()||!this.loaded()||this.restoringCamera||!element)return;const orbit=element.getCameraOrbit();if([orbit.theta,orbit.phi,orbit.radius].every(Number.isFinite))this.cameraChanged.emit((orbit.theta*180/Math.PI)+'deg '+(orbit.phi*180/Math.PI)+'deg '+orbit.radius+'m');}
  onError() { this.cancelReturn(); this.restAngle=undefined; this.failed.set(true); }
  retry() { this.loaded.set(false); this.failed.set(false); }
  ngOnDestroy() { this.cancelReturn();this.textureRequest++;this.textureCache.clear();this.media.removeEventListener('change', this.changed); }
}
