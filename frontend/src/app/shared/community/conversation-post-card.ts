// ALTEGO necesita resolver la presentación de publicaciones y sus acciones.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {LiveAvatar} from "../profile/live-avatar";
import {AccountBadges} from "../identity/account-badges";
import {DatePipe} from '@angular/common';
import {afterRenderEffect, Component, computed, effect, ElementRef, input, output, signal, viewChild} from '@angular/core';
import {RouterLink} from '@angular/router';
import type {ConversationPost} from "../../core/http/api";
import {Icon} from "../ui/icon";
import {GlassPanel, VisualButton} from "../ui/visual-primitives";

export type ConversationPostAction = 'open' | 'copy' | 'edit' | 'pin' | 'delete' | 'report';
export type ConversationImageSelection = {index: number; trigger: HTMLButtonElement};
const relativeFormatter = new Intl.RelativeTimeFormat('en', {numeric: 'always'});

export function conversationDate(timestamp: string, now: number): string | null {
  const seconds = Math.max(0, Math.floor((now - Date.parse(timestamp)) / 1000));
  if (!Number.isFinite(seconds) || seconds >= 7 * 86400) return null;
  if (seconds < 60) return 'Just now';
  if (seconds >= 86400 && seconds < 2 * 86400) return 'Yesterday';
  const [unit, divisor] = seconds >= 86400 ? ['day', 86400] as const
    : seconds >= 3600 ? ['hour', 3600] as const : ['minute', 60] as const;
  return relativeFormatter.format(-Math.floor(seconds / divisor), unit);
}

@Component({
  selector: 'app-conversation-post-card',
  imports:[LiveAvatar,AccountBadges, DatePipe, RouterLink, GlassPanel, Icon, VisualButton],
  templateUrl: './conversation-post-card.html',
  styleUrl: './conversation-post-card.css',
})
export class ConversationPostCard {
  post = input.required<ConversationPost>();
  now = input.required<number>();
  owner = input(false);
  admin = input(false);
  mayReport = input(false);
  detail = input(false);
  busy = input(false);
  copied = input(false);
  action = output<ConversationPostAction>();
  image = output<ConversationImageSelection>();
  expanded = signal(false);
  showDate = signal(false);
  longDescription = signal(false);
  menuOpen = signal(false);
  relativeDate = computed(() => conversationDate(this.post().created_at, this.now()));
  previewImages = computed(() => this.post().images.slice(0, 4));
  menuId = computed(() => 'post-actions-' + this.post().id + (this.detail() ? '-detail' : '-feed'));
  private menu = viewChild<ElementRef<HTMLElement>>('menu');
  private menuTrigger = viewChild<ElementRef<HTMLButtonElement>>('menuTrigger');
  private descriptionText = viewChild<ElementRef<HTMLParagraphElement>>('descriptionText');

  constructor() {
    afterRenderEffect(onCleanup => {
      if (!this.menuOpen()) return;
      const menu = this.menu()?.nativeElement;
      const trigger = this.menuTrigger()?.nativeElement;
      if (!menu || !trigger) return;

      const document = menu.ownerDocument;
      menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({preventScroll: true});

      const dismissOutside = (event: MouseEvent) => {
        if (!(event.target instanceof Node) || trigger.contains(event.target) || menu.contains(event.target)) return;
        this.closeMenu(menu.contains(document.activeElement));
      };
      const dismissWithEscape = (event: KeyboardEvent) => {
        if (event.key !== 'Escape' || event.defaultPrevented) return;
        event.preventDefault();
        this.closeMenu(menu.contains(document.activeElement) || trigger === document.activeElement);
      };
      document.addEventListener('click', dismissOutside);
      document.addEventListener('keydown', dismissWithEscape);
      onCleanup(() => {
        document.removeEventListener('click', dismissOutside);
        document.removeEventListener('keydown', dismissWithEscape);
      });
    });

    effect(onCleanup => {
      const text = this.descriptionText()?.nativeElement;
      if (!text || !this.post().description) return;

      const observer = new ResizeObserver(() => {
        if (!text.clientWidth) return;
        const lineHeight = Number.parseFloat(getComputedStyle(text).lineHeight);
        this.longDescription.set(text.scrollHeight > lineHeight * 3 + 1);
      });
      observer.observe(text);
      onCleanup(() => observer.disconnect());
    });
  }

  openFromSurface(event: MouseEvent) {
    if (this.detail() || event.defaultPrevented || event.button !== 0 ||
        !(event.target instanceof Element) ||
        event.target.closest('a,button,input,select,textarea,label,summary,[popover],.post-menu,[role=button],[contenteditable]') ||
        window.getSelection()?.type === 'Range') return;
    this.action.emit('open');
  }

  toggleMenu() {
    if (this.menuOpen()) this.closeMenu();
    else this.menuOpen.set(true);
  }

  runMenuAction(action: ConversationPostAction) {
    this.closeMenu();
    this.action.emit(action);
  }

  private closeMenu(restoreFocus = true) {
    this.menuOpen.set(false);
    if (restoreFocus) this.menuTrigger()?.nativeElement.focus({preventScroll: true});
  }
}
