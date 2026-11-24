// ALTEGO necesita resolver la iluminación ambiental decorativa.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import { Component, ChangeDetectionStrategy } from '@angular/core';


@Component({
  selector: 'app-ambient-background',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-hidden': 'true' },
  styleUrl: './ambient-background.css',
  template: '<i class="ambient-light rose"></i><i class="ambient-light lavender"></i><i class="ambient-light blue"></i><i class="ambient-light peach"></i><i class="ambient-light mint"></i>'
})
export class AmbientBackground {}
