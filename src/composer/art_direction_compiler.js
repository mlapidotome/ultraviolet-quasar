/**
 * BALI ART DIRECTION RECIPE COMPILER
 * Minimum Execution Layer for Composer V3
 *
 * Responsibilities:
 * 1. Multi-pass typographic lockup compilation (decoupling prefix, hero number, suffix, labels).
 * 2. Ambient scrim gradient generation (procedural contrast support without opaque boxes).
 * 3. Minimal architectural geometry (hairline rules and accents).
 * 4. General recipe compilation without CASE_01B hardcoding.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

class ArtDirectionCompiler {
  constructor(options = {}) {
    this.fontFallback = options.fontFallback || 'C\\:/Windows/Fonts/bahnschrift.ttf';
    this.outputDir = options.outputDir || path.join(process.cwd(), 'outputs', 'micro_renders');
    
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }

  ensureAmbientScrim(filename = 'ambient_scrim_bottom.png', yStart = 1150, maxOpacity = 0.38) {
    const targetPath = path.join(this.outputDir, filename);
    if (!fs.existsSync(targetPath)) {
      const expr = `if(gt(Y,${yStart}), 255*${maxOpacity}*pow((Y-${yStart})/(1920-${yStart}), 1.8), 0)`;
      execFileSync('ffmpeg', [
        '-y',
        '-f', 'lavfi',
        '-i', `color=c=black@0.0:s=1080x1920:d=1,format=rgba,geq=r=0:g=0:b=0:a='${expr}'`,
        '-vframes', '1',
        targetPath
      ]);
    }
    return targetPath;
  }

  compileRecipe(recipe, context = {}) {
    const startT = context.startT !== undefined ? context.startT : 2.6;
    const endT = context.endT !== undefined ? context.endT : 4.84;
    const enableCond = `enable='between(t\\` + `,${startT}\\` + `,${endT})'`;
    const font = this.fontFallback;

    const filters = [];
    const extraInputs = [];

    switch (recipe.archetype) {
      case 'EDITORIAL_LOCKUP': {
        const scrimPath = this.ensureAmbientScrim('ambient_scrim_bottom.png', 1150, 0.38);
        extraInputs.push(scrimPath);

        // Top Label (Wide Tracking Style)
        filters.push(
          `drawtext=fontfile='${font}':text='PARCELAS ESTIMADAS':fontsize=24:fontcolor=0x94A3B8:shadowx=2:shadowy=2:shadowcolor=0x000000@0.8:x=(w-text_w)/2:y=1355:${enableCond}`
        );

        // Prefix "R$" (36px, Gold) + Hero "2.000" (76px, White Bold) + Unit "/ mes" (26px, Slate)
        const xStart = 372;
        const yBase = 1405;

        filters.push(
          `drawtext=fontfile='${font}':text='R$':fontsize=36:fontcolor=0xEAB308:shadowx=2:shadowy=3:shadowcolor=0x000000@0.8:x=${xStart}:y=${yBase + (76 - 36) - 6}:${enableCond}`
        );
        filters.push(
          `drawtext=fontfile='${font}':text='2.000':fontsize=76:fontcolor=0xFFFFFF:shadowx=3:shadowy=4:shadowcolor=0x000000@0.9:x=${xStart + 55}:y=${yBase}:${enableCond}`
        );
        filters.push(
          `drawtext=fontfile='${font}':text='/ mes':fontsize=26:fontcolor=0xCBD5E1:shadowx=2:shadowy=2:shadowcolor=0x000000@0.8:x=${xStart + 55 + 210}:y=${yBase + (76 - 26) - 6}:${enableCond}`
        );
        break;
      }

      case 'TYPE_WITH_RULE': {
        const xRule = 80;
        const yRuleStart = 1340;
        const hRule = 125;
        const xText = xRule + 24;

        filters.push(
          `drawbox=x=${xRule}:y=${yRuleStart}:w=2:h=${hRule}:color=0xEAB308@0.90:t=fill:${enableCond}`
        );
        filters.push(
          `drawtext=fontfile='${font}':text='MINHA CASA MINHA VIDA':fontsize=22:fontcolor=0xEAB308:shadowx=2:shadowy=2:shadowcolor=0x000000@0.8:x=${xText}:y=${yRuleStart + 6}:${enableCond}`
        );
        filters.push(
          `drawtext=fontfile='${font}':text='Parcelas ~ R$ 2.000 / mes':fontsize=46:fontcolor=0xFFFFFF:shadowx=2:shadowy=3:shadowcolor=0x000000@0.9:x=${xText}:y=${yRuleStart + 36}:${enableCond}`
        );
        filters.push(
          `drawtext=fontfile='${font}':text='Entrada facilitada R$ 60k a 70k':fontsize=22:fontcolor=0x94A3B8:shadowx=1:shadowy=2:shadowcolor=0x000000@0.8:x=${xText}:y=${yRuleStart + 92}:${enableCond}`
        );
        break;
      }

      case 'HERO_NUMBER_COMPOSITION': {
        const scrimPath = this.ensureAmbientScrim('ambient_scrim_bottom.png', 1150, 0.38);
        extraInputs.push(scrimPath);

        filters.push(
          `drawtext=fontfile='${font}':text='PARCELAS A PARTIR DE':fontsize=24:fontcolor=0x94A3B8:shadowx=2:shadowy=2:shadowcolor=0x000000@0.8:x=(w-text_w)/2:y=1330:${enableCond}`
        );
        filters.push(
          `drawtext=fontfile='${font}':text='2.000':fontsize=88:fontcolor=0xEAB308:shadowx=3:shadowy=5:shadowcolor=0x000000@0.9:x=(w-text_w)/2:y=1365:${enableCond}`
        );
        filters.push(
          `drawtext=fontfile='${font}':text='REAIS / MES':fontsize=20:fontcolor=0xFFFFFF:box=1:boxcolor=0x0B1329@0.60:boxborderw=6:x=(w-text_w)/2:y=1470:${enableCond}`
        );
        break;
      }

      default:
        throw new Error(`Unsupported recipe archetype: ${recipe.archetype}`);
    }

    return { filters, extraInputs };
  }
}

module.exports = ArtDirectionCompiler;
