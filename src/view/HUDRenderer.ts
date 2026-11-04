import { PALETTE, SCREEN_HEIGHT, SCREEN_WIDTH, MAP_VIEW_WIDTH, MAP_VIEW_HEIGHT } from '../config/Constants.js';
import { Player } from '../models/Player.js';
import { MagicType } from '../models/Types.js';

export class HUDRenderer {
  public static render(
    ctx: CanvasRenderingContext2D,
    player: Player,
    indicatorRatio: number, // 0.0 〜 1.0
    selectedMagic?: MagicType
  ): void {
    // 1. 右側サイドパネル (X: 240〜320, Y: 0〜200)
    const panelX = MAP_VIEW_WIDTH;
    const panelW = SCREEN_WIDTH - MAP_VIEW_WIDTH; // 80px

    ctx.fillStyle = '#0a0d14';
    ctx.fillRect(panelX, 0, panelW, SCREEN_HEIGHT);

    // 縦の仕切り線
    ctx.fillStyle = PALETTE.WHITE;
    ctx.fillRect(panelX, 0, 1, SCREEN_HEIGHT);

    // フォント設定
    ctx.font = '8px monospace';
    ctx.textBaseline = 'top';

    const leftMargin = panelX + 5;
    let textY = 4;
    const lineSpacing = 16;

    // HITPOINTS
    ctx.fillStyle = player.hp < 500 ? PALETTE.RED : PALETTE.YELLOW;
    ctx.fillText('HITPOINTS', leftMargin, textY);
    ctx.fillStyle = PALETTE.WHITE;
    ctx.fillText(`${player.hp.toString().padStart(6, ' ')}`, leftMargin, textY + 7);
    textY += lineSpacing;

    // STRENGTH
    ctx.fillStyle = PALETTE.YELLOW;
    ctx.fillText('STRENGTH', leftMargin, textY);
    ctx.fillStyle = PALETTE.WHITE;
    ctx.fillText(`${player.strength.toString().padStart(6, ' ')}`, leftMargin, textY + 7);
    textY += lineSpacing;

    // EXPERIENCE
    ctx.fillStyle = PALETTE.YELLOW;
    ctx.fillText('EXPERIENCE', leftMargin, textY);
    ctx.fillStyle = PALETTE.WHITE;
    ctx.fillText(`${player.experience.toString().padStart(6, ' ')}`, leftMargin, textY + 7);
    textY += lineSpacing;

    // GOLD
    ctx.fillStyle = PALETTE.YELLOW;
    ctx.fillText('GOLD', leftMargin, textY);
    ctx.fillStyle = PALETTE.WHITE;
    ctx.fillText(`${player.gold.toString().padStart(6, ' ')}`, leftMargin, textY + 7);
    textY += lineSpacing;

    // MAGIC
    ctx.fillStyle = PALETTE.YELLOW;
    ctx.fillText('MAGIC', leftMargin, textY);
    ctx.fillStyle = PALETTE.WHITE;
    ctx.fillText(`${player.magic.toString().padStart(6, ' ')}`, leftMargin, textY + 7);
    textY += lineSpacing;

    // CROWN
    ctx.fillStyle = PALETTE.YELLOW;
    ctx.fillText('CROWN', leftMargin, textY);
    ctx.fillStyle = player.crowns === 4 ? PALETTE.GREEN : PALETTE.WHITE;
    ctx.fillText(`${player.crowns} / 4`, leftMargin + 8, textY + 7);
    textY += lineSpacing;

    // HOLD ITEM
    ctx.fillStyle = PALETTE.YELLOW;
    ctx.fillText('ITEM', leftMargin, textY);
    ctx.fillStyle = PALETTE.CYAN;
    const itemStr = player.holdItem === 'NONE' ? '(NONE)' : player.holdItem;
    ctx.fillText(itemStr, leftMargin, textY + 7);
    textY += lineSpacing;

    // 選択中魔法 (SPELL)
    if (selectedMagic) {
      ctx.fillStyle = PALETTE.YELLOW;
      ctx.fillText('SPELL [X]', leftMargin, textY);
      ctx.fillStyle = PALETTE.CYAN;
      ctx.fillText(`*${selectedMagic}*`, leftMargin, textY + 7);
      textY += lineSpacing;
    }

    // 剣の所持状態
    ctx.fillStyle = player.hasSword ? PALETTE.GREEN : PALETTE.RED;
    ctx.fillText(player.hasSword ? '[SWORD: OK]' : '[NO SWORD]', leftMargin, textY);
    textY += 10;

    // FLY または 死神憑依警告
    if (player.isFlying) {
      ctx.fillStyle = PALETTE.CYAN;
      ctx.fillText(`* FLY: ${player.flyTimer} *`, leftMargin, textY);
    } else if (player.hasDeath) {
      ctx.fillStyle = PALETTE.RED;
      ctx.fillText('* DEATH *', leftMargin, textY);
    }

    // 2. 下部メッセージ・インジケーターバー (X: 0〜240, Y: 176〜200)
    const bottomY = MAP_VIEW_HEIGHT;
    const bottomH = SCREEN_HEIGHT - MAP_VIEW_HEIGHT; // 24px

    ctx.fillStyle = '#06080c';
    ctx.fillRect(0, bottomY, MAP_VIEW_WIDTH, bottomH);

    // 横の仕切り線
    ctx.fillStyle = PALETTE.WHITE;
    ctx.fillRect(0, bottomY, MAP_VIEW_WIDTH, 1);

    // ステージクリア時のメッセージ表示
    if (player.isStageCleared) {
      ctx.fillStyle = PALETTE.YELLOW;
      ctx.font = 'bold 10px monospace';
      ctx.fillText('*** CONGRATULATIONS! STAGE CLEAR! ***', 16, bottomY + 7);
      return;
    }

    // インジケーター表示 (時間制限ゲージ)
    ctx.fillStyle = PALETTE.WHITE;
    ctx.fillText('TIME:', 6, bottomY + 7);

    const gaugeX = 36;
    const gaugeY = bottomY + 7;
    const gaugeW = 194;
    const gaugeH = 9;

    // ゲージ外枠
    ctx.strokeStyle = PALETTE.WHITE;
    ctx.strokeRect(gaugeX, gaugeY, gaugeW, gaugeH);

    // ゲージ内部の塗り（時間経過で左から右へ充填）
    const fillW = Math.min(gaugeW - 2, Math.max(0, Math.floor((gaugeW - 2) * indicatorRatio)));
    ctx.fillStyle = indicatorRatio > 0.8 ? PALETTE.RED : PALETTE.CYAN;
    ctx.fillRect(gaugeX + 1, gaugeY + 1, fillW, gaugeH - 2);

    // ゲージ内の動く人アイコン/マーク（インジケーター）
    const runnerX = gaugeX + fillW;
    ctx.fillStyle = PALETTE.YELLOW;
    ctx.fillRect(runnerX - 1, gaugeY - 1, 3, gaugeH + 2);
  }
}
