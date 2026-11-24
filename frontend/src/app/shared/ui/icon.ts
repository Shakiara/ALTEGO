// ALTEGO necesita resolver la presentación uniforme de iconos.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {Component,computed,input} from '@angular/core';
import {FaIconComponent} from '@fortawesome/angular-fontawesome';
import {iconDefinitions} from './icon-registry';

@Component({selector:'app-icon',imports:[FaIconComponent],host:{'aria-hidden':'true'},template:`
 @switch(name()){
  @case('pin'){<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path fill="var(--pin-fill,none)" d="M8 3h8l-1 6 4 4v2H5v-2l4-4Z"/><path d="M12 15v7"/></svg>}
  @case('hair'){<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M8 20 4 21l1-8C3 7 7 2 12 3c5-1 9 4 7 10l1 8-4-1M8 20l1-8c3 0 5-3 5-5 0 3 2 4 3 5l-1 8"/></svg>}
  @case('accessories'){<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M11 10C8 3 2 4 3 9s5 5 8 3m2-2c3-7 9-6 8-1s-5 5-8 3M10 13l-3 8 5-3 5 3-3-8"/><rect x="10" y="9" width="4" height="5" rx="1"/></svg>}
  @default{<fa-icon [icon]="definition()" aria-hidden="true"/>}
 }
`,styles:`:host{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;flex:0 0 auto;line-height:1;vertical-align:middle;pointer-events:none}fa-icon{display:inline-flex;align-items:center;justify-content:center;width:100%;height:100%;line-height:1}svg{display:block;width:100%;height:100%}`})
export class Icon{
 name=input('user');
 definition=computed(()=>iconDefinitions[this.name()]||iconDefinitions['unknown']);
}
