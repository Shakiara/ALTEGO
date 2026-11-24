// ALTEGO necesita definir los contratos de datos del perfil.
// Este módulo declara las estructuras compartidas para intercambiar esos datos con tipos consistentes.
export interface Framing {
    zoom: number;
    x: number;
    y: number;
}
export interface ProfileImage {
    kind: 'default' | 'upload' | 'roblox' | 'preset';
    media_id?: string | null;
    crop?: Framing;
    preset?: string;
    roblox_token?: string;
    roblox_user_id?: number;
    roblox_username?: string;
}
export interface SocialLink {
    id: string;
    platform: string;
    label: string;
    url: string;
}
export interface ProfileDraft {
    revision: number;
    display_name: string;
    bio: string;
    socials: SocialLink[];
    avatar: ProfileImage;
    banner: ProfileImage;
    pinned_product_id: number | null;
}
export const bannerPresets = [{ id: 'rose', label: 'Rose', background: 'linear-gradient(120deg,#f3cadb,#f9e7dd)' }, { id: 'lavender', label: 'Lavender', background: 'linear-gradient(120deg,#e0d5f3,#eee6f7)' }, { id: 'peach', label: 'Peach', background: 'linear-gradient(120deg,#f8dfc9,#f3d8e5)' }, { id: 'mint', label: 'Mint', background: 'linear-gradient(120deg,#d2eae1,#e5eff0)' }, { id: 'cloud', label: 'Cloud', background: 'linear-gradient(120deg,#dce8f4,#f6f2ed)' }, { id: 'dusk', label: 'Dusk', background: 'linear-gradient(120deg,#e0d5ed,#eecfdc,#e4e5f4)' }];
export const defaultFraming = (): Framing => ({ zoom: 1, x: 50, y: 50 });
