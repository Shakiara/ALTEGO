// ALTEGO necesita resolver los controles visuales y diálogos compartidos.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import { Directive } from '@angular/core';

@Directive({ selector: '[appGlass]', host: { class: 'glass-panel' } })
export class GlassPanel {}

@Directive({ selector: 'button[appButton], a[appButton]', host: { class: 'ui-button' } })
export class VisualButton {}

@Directive({ selector: 'input[appField], textarea[appField], select[appField]', host: { class: 'ui-field' } })
export class VisualField {}


@Directive({ selector: 'dialog[appModal]', host: { class: 'glass-panel ui-modal' } })
export class VisualModal {}
