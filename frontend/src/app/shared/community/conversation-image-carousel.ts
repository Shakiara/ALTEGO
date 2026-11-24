// ALTEGO necesita resolver la exploración de imágenes de publicaciones.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {Component, input, model} from '@angular/core';
import {Icon} from "../ui/icon";
import {VisualButton} from "../ui/visual-primitives";

@Component({
  selector: 'app-conversation-image-carousel',
  imports: [Icon, VisualButton],
  template: `
    <div class="carousel" aria-label="Post images"
      (pointerdown)="startSwipe($event)" (pointerup)="endSwipe($event)" (pointercancel)="cancelSwipe()">
      @if (images()[index()]; as image) {
        <img [src]="image.url" [alt]="'Post image ' + (index() + 1)" draggable="false">
      }
      <div class="carousel-controls">
        @if (images().length > 1) {
          <button appButton type="button" class="icon-control" aria-label="Previous image" (click)="move(-1)"><app-icon name="chevron-left"/></button>
        }
        <span class="position" role="status">{{index() + 1}} / {{images().length}}</span>
        @if (images().length > 1) {
          <button appButton type="button" class="icon-control" aria-label="Next image" (click)="move(1)"><app-icon name="chevron-right"/></button>
        }
      </div>
    </div>
  `,
  styles: `
    :host{display:block;min-width:0}
    .carousel{touch-action:pan-y;min-width:0}
    img{display:block;width:100%;height:min(68dvh,720px);object-fit:contain;border-radius:14px;background:#160f1b}
    .carousel-controls{display:flex;align-items:center;justify-content:center;gap:20px;margin-top:8px}
    .position{font-size:13px;color:#f0e4f2;font-variant-numeric:tabular-nums}
    .carousel-controls .icon-control{width:44px;height:44px;min-width:44px;color:#fff;background:#ffffff16;border:1px solid #ffffff44;box-shadow:none}
    .carousel-controls .icon-control:hover{background:#ffffff28}
    @media(max-height:420px){img{height:50dvh}}
  `,
})
export class ConversationImageCarousel {
  images = input.required<readonly {url: string}[]>();
  index = model(0);
  private touch?: {x: number; y: number};

  move(delta: number) {
    const count = this.images().length;
    if (count > 1) this.index.update(index => (index + delta + count) % count);
  }

  startSwipe(event: PointerEvent) {
    if (event.pointerType === 'touch') this.touch = {x: event.clientX, y: event.clientY};
  }

  endSwipe(event: PointerEvent) {
    const start = this.touch;
    this.touch = undefined;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) >= 35 && Math.abs(dx) > Math.abs(dy)) this.move(dx < 0 ? 1 : -1);
  }

  cancelSwipe() { this.touch = undefined; }
}
