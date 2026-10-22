// Fonts a timeline may name. Only the font a video actually uses is loaded (on first use).
import * as Montserrat from '@remotion/google-fonts/Montserrat';
import * as Anton from '@remotion/google-fonts/Anton';
import * as BebasNeue from '@remotion/google-fonts/BebasNeue';
import * as Inter from '@remotion/google-fonts/Inter';
import * as Poppins from '@remotion/google-fonts/Poppins';
import * as Oswald from '@remotion/google-fonts/Oswald';
import * as Roboto from '@remotion/google-fonts/Roboto';
import * as PlayfairDisplay from '@remotion/google-fonts/PlayfairDisplay';
import * as Bangers from '@remotion/google-fonts/Bangers';
import * as SpaceGrotesk from '@remotion/google-fonts/SpaceGrotesk';
import * as ArchivoBlack from '@remotion/google-fonts/ArchivoBlack';
import * as Lora from '@remotion/google-fonts/Lora';
import * as DMSerifDisplay from '@remotion/google-fonts/DMSerifDisplay';
import * as PermanentMarker from '@remotion/google-fonts/PermanentMarker';
import * as RubikMonoOne from '@remotion/google-fonts/RubikMonoOne';

type Loader = { loadFont: (...a: any[]) => { fontFamily: string } };
// Weights each family really has (asking for a missing one makes the loader throw).
const FONTS: Record<string, [Loader, string[]]> = {
  montserrat: [Montserrat as Loader, ['600', '800', '900']],
  anton: [Anton as Loader, ['400']],
  bebasneue: [BebasNeue as Loader, ['400']],
  inter: [Inter as Loader, ['500', '700', '900']],
  poppins: [Poppins as Loader, ['600', '800', '900']],
  oswald: [Oswald as Loader, ['500', '700']],
  roboto: [Roboto as Loader, ['500', '700', '900']],
  playfairdisplay: [PlayfairDisplay as Loader, ['700', '900']],
  bangers: [Bangers as Loader, ['400']],
  spacegrotesk: [SpaceGrotesk as Loader, ['500', '700']],
  archivoblack: [ArchivoBlack as Loader, ['400']],
  lora: [Lora as Loader, ['600', '700']],
  dmserifdisplay: [DMSerifDisplay as Loader, ['400']],
  permanentmarker: [PermanentMarker as Loader, ['400']],
  rubikmonoone: [RubikMonoOne as Loader, ['400']],
};
export const FONT_NAMES = Object.keys(FONTS);

const cache: Record<string, { family: string; weights: number[] }> = {};

/** CSS font-family for a font name ('Bebas Neue', 'bebas-neue' and 'BebasNeue' all work). */
export function font(name?: string): { family: string; weight: (want: number) => number } {
  const key = (name || 'Montserrat').toLowerCase().replace(/[^a-z]/g, '');
  const k = FONTS[key] ? key : 'montserrat';
  if (!cache[k]) {
    const [mod, weights] = FONTS[k];
    const { fontFamily } = mod.loadFont('normal', { weights, subsets: ['latin'] });
    cache[k] = { family: fontFamily, weights: weights.map(Number) };
  }
  const c = cache[k];
  // Closest weight the family has, so a 900 request on a one-weight display font stays crisp.
  return { family: c.family, weight: (want) => c.weights.reduce((a, b) => (Math.abs(b - want) < Math.abs(a - want) ? b : a), c.weights[0]) };
}
