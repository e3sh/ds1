import { DungeonTopology, Position } from '../../models/Types.js';
import { WorldMap } from '../../models/WorldMap.js';
import { SeedRandom } from '../../core/SeedRandom.js';
import {
  BLOCK_SIZE_TILES,
  CELL_SIZE_TILES,
  PlacedThemeBlock,
  WORLD_SIZE_TILES,
} from './ThemeBlockTypes.js';

export interface TerrainBuildContext {
  topology: DungeonTopology;
  placedBlocks: PlacedThemeBlock[];
  dragonCenter: Position;
  homePos: Position;
  rng: SeedRandom;
}

/**
 * ハイブリッド生成における非ブロック領域（ベース空間）の連続トポロジー地形生成器
 *
 * 配置済みのランドマーク／パズル拠点ブロックを保護した上で、
 * 残りの 64x64 トーラス空間をトポロジー固有のアルゴリズムで連続生成する。
 */
export class TopologyTerrainBuilder {
  private static readonly W = WORLD_SIZE_TILES;

  public static build(map: WorldMap, ctx: TerrainBuildContext): void {
    const { topology } = ctx;
    if (topology === 'STANDARD_ROOMS' || topology === 'CLASSIC_FIXED') {
      return;
    }

    const protectedMask = this.buildProtectedMask(map, ctx.placedBlocks, ctx.dragonCenter, ctx.homePos);
    const portClearanceMask = this.buildPortClearanceMask(ctx.placedBlocks);

    switch (topology) {
      case 'PILLAR_GRID':
        this.buildPillarGrid(map, protectedMask, portClearanceMask, ctx.rng);
        break;
      case 'NARROW_MAZE':
        this.buildNarrowMaze(map, protectedMask, portClearanceMask, ctx.rng);
        break;
      case 'FORTRESS_ARENA':
        this.buildFortressArena(map, protectedMask, portClearanceMask, ctx.dragonCenter, ctx.rng);
        break;
      case 'SPIRAL_LABYRINTH':
        this.buildSpiralLabyrinth(map, protectedMask, portClearanceMask, ctx.dragonCenter, ctx.rng);
        break;
      case 'MULTI_SECTOR':
        this.buildMultiSector(map, protectedMask, portClearanceMask, ctx.rng);
        break;
    }
  }

  private static toIdx(x: number, y: number): number {
    const W = this.W;
    return (((y % W) + W) % W) * W + (((x % W) + W) % W);
  }

  /**
   * 配置済みブロック占有領域およびドラゴン・我が家コアの保護マスクを構築
   */
  private static buildProtectedMask(
    map: WorldMap,
    placedBlocks: PlacedThemeBlock[],
    dragonCenter: Position,
    homePos: Position
  ): Uint8Array {
    const W = this.W;
    const mask = new Uint8Array(W * W);

    for (const pb of placedBlocks) {
      const sizeTiles = BLOCK_SIZE_TILES[pb.template.size];
      const ox = pb.cellX * CELL_SIZE_TILES;
      const oy = pb.cellY * CELL_SIZE_TILES;
      for (let ly = 0; ly < sizeTiles; ly++) {
        for (let lx = 0; lx < sizeTiles; lx++) {
          mask[this.toIdx(ox + lx, oy + ly)] = 1;
        }
      }
    }

    // ドラゴン周囲 7x7 保護
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        mask[this.toIdx(dragonCenter.x + dx, dragonCenter.y + dy)] = 1;
      }
    }

    // 我が家周囲 3x3 保護
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        mask[this.toIdx(homePos.x + dx, homePos.y + dy)] = 1;
      }
    }

    // 既に特殊タイル・オブジェクトがあるマスも保護
    for (let y = 0; y < W; y++) {
      for (let x = 0; x < W; x++) {
        const p = { x, y };
        if (map.getBaseTile(p) !== 'EMPTY' || map.getObject(p) !== 'NONE' || map.getItem(p) !== 'NONE') {
          mask[this.toIdx(x, y)] = 1;
        }
      }
    }

    return mask;
  }

  /**
   * 配置済みブロックのエッジポート直前（外側1〜2マス）を通路として保護するマスク
   */
  private static buildPortClearanceMask(placedBlocks: PlacedThemeBlock[]): Uint8Array {
    const W = this.W;
    const mask = new Uint8Array(W * W);

    for (const pb of placedBlocks) {
      if (!pb.template.edgePorts) continue;
      const sizeTiles = pb.template.layout.length;
      const ox = pb.cellX * CELL_SIZE_TILES;
      const oy = pb.cellY * CELL_SIZE_TILES;

      for (const port of pb.template.edgePorts) {
        let lx = 0;
        let ly = 0;
        let dx = 0;
        let dy = 0;
        switch (port.direction) {
          case 'NORTH':
            lx = port.cellIndex * 4 + port.offsetInCell;
            ly = 0;
            dy = -1;
            break;
          case 'SOUTH':
            lx = port.cellIndex * 4 + port.offsetInCell;
            ly = sizeTiles - 1;
            dy = 1;
            break;
          case 'WEST':
            lx = 0;
            ly = port.cellIndex * 4 + port.offsetInCell;
            dx = -1;
            break;
          case 'EAST':
            lx = sizeTiles - 1;
            ly = port.cellIndex * 4 + port.offsetInCell;
            dx = 1;
            break;
        }
        if (pb.template.layout[ly]?.[lx] === '.') {
          const wx = ox + lx;
          const wy = oy + ly;
          mask[this.toIdx(wx + dx, wy + dy)] = 1;
          mask[this.toIdx(wx + dx * 2, wy + dy * 2)] = 1;
        }
      }
    }

    return mask;
  }

  private static canPlaceBlock(
    map: WorldMap,
    protectedMask: Uint8Array,
    portClearanceMask: Uint8Array,
    x: number,
    y: number
  ): boolean {
    const idx = this.toIdx(x, y);
    if (protectedMask[idx] || portClearanceMask[idx]) return false;
    const p = map.wrapPosition({ x, y });
    return map.getBaseTile(p) === 'EMPTY' && map.getObject(p) === 'NONE' && map.getItem(p) === 'NONE';
  }

  /**
   * 1. PILLAR_GRID: 全面2マス間隔ピラー（＋一部L字連結柱）
   */
  private static buildPillarGrid(
    map: WorldMap,
    protectedMask: Uint8Array,
    portClearanceMask: Uint8Array,
    rng: SeedRandom,
    bounds?: { x1: number; y1: number; x2: number; y2: number }
  ): void {
    const x1 = bounds?.x1 ?? 0;
    const y1 = bounds?.y1 ?? 0;
    const x2 = bounds?.x2 ?? this.W - 1;
    const y2 = bounds?.y2 ?? this.W - 1;

    const placedPillars: Position[] = [];
    for (let y = y1; y <= y2; y++) {
      for (let x = x1; x <= x2; x++) {
        if (x % 2 === 0 && y % 2 === 0) {
          if (this.canPlaceBlock(map, protectedMask, portClearanceMask, x, y)) {
            map.setObject(map.wrapPosition({ x, y }), 'BLOCK');
            placedPillars.push({ x, y });
          }
        }
      }
    }

    // 約12%のピラーをL字または2連柱に拡張（ただし他の柱と連結しないよう周辺チェック）
    const cardDirs = [
      { dx: 1, dy: 0 },
      { dx: -1, dy: 0 },
      { dx: 0, dy: 1 },
      { dx: 0, dy: -1 },
    ];
    for (const pillar of placedPillars) {
      if (!rng.chance(0.12)) continue;
      const d = cardDirs[rng.nextInt(0, 3)];
      const nx = pillar.x + d.dx;
      const ny = pillar.y + d.dy;
      if (nx < x1 || nx > x2 || ny < y1 || ny > y2) continue;
      if (!this.canPlaceBlock(map, protectedMask, portClearanceMask, nx, ny)) continue;

      // 拡張先の4近傍に元の柱以外のBLOCKがなければ安全にL字・2連化できる
      let otherBlocks = 0;
      for (const cd of cardDirs) {
        const ax = nx + cd.dx;
        const ay = ny + cd.dy;
        if (ax === pillar.x && ay === pillar.y) continue;
        if (map.getObject(map.wrapPosition({ x: ax, y: ay })) === 'BLOCK') {
          otherBlocks++;
        }
      }
      if (otherBlocks === 0) {
        map.setObject(map.wrapPosition({ x: nx, y: ny }), 'BLOCK');
      }
    }
  }

  /**
   * 2. NARROW_MAZE: 全面BLOCKからの連続した幅1マス迷路（穴掘り法＋ループ間引き）
   */
  private static buildNarrowMaze(
    map: WorldMap,
    protectedMask: Uint8Array,
    portClearanceMask: Uint8Array,
    rng: SeedRandom,
    bounds?: { x1: number; y1: number; x2: number; y2: number }
  ): void {
    const W = this.W;
    const x1 = bounds?.x1 ?? 0;
    const y1 = bounds?.y1 ?? 0;
    const x2 = bounds?.x2 ?? W - 1;
    const y2 = bounds?.y2 ?? W - 1;
    const isBounded = bounds !== undefined;

    // 1. 未保護領域を一旦全面BLOCKで埋める（ポートクリアランスは空ける）
    for (let y = y1; y <= y2; y++) {
      for (let x = x1; x <= x2; x++) {
        if (this.canPlaceBlock(map, protectedMask, portClearanceMask, x, y)) {
          map.setObject(map.wrapPosition({ x, y }), 'BLOCK');
        }
      }
    }

    // 2. 奇数座標 (x%2===1, y%2===1) を通路ノードとして穴掘り法（ランダム化DFS）
    const visited = new Uint8Array(W * W);
    const stepDirs = [
      { dx: 2, dy: 0, mx: 1, my: 0 },
      { dx: -2, dy: 0, mx: -1, my: 0 },
      { dx: 0, dy: 2, mx: 0, my: 1 },
      { dx: 0, dy: -2, mx: 0, my: -1 },
    ];

    const inBounds = (x: number, y: number): boolean => {
      if (!isBounded) return true;
      return x >= x1 && x <= x2 && y >= y1 && y <= y2;
    };

    const isCarvableNode = (x: number, y: number): boolean => {
      if (!inBounds(x, y)) return false;
      const idx = this.toIdx(x, y);
      return !protectedMask[idx];
    };

    const carveFrom = (startX: number, startY: number) => {
      const stack: Position[] = [{ x: startX, y: startY }];
      visited[this.toIdx(startX, startY)] = 1;
      map.setObject(map.wrapPosition({ x: startX, y: startY }), 'NONE');

      while (stack.length > 0) {
        const cur = stack[stack.length - 1];
        const shuffled = rng.shuffle([...stepDirs]);
        let carved = false;

        for (const d of shuffled) {
          const nx = isBounded ? cur.x + d.dx : (cur.x + d.dx + W) % W;
          const ny = isBounded ? cur.y + d.dy : (cur.y + d.dy + W) % W;
          if (!isCarvableNode(nx, ny)) continue;

          const nIdx = this.toIdx(nx, ny);
          if (visited[nIdx]) continue;

          const mx = isBounded ? cur.x + d.mx : (cur.x + d.mx + W) % W;
          const my = isBounded ? cur.y + d.my : (cur.y + d.my + W) % W;
          if (protectedMask[this.toIdx(mx, my)]) continue;

          visited[nIdx] = 1;
          map.setObject(map.wrapPosition({ x: mx, y: my }), 'NONE');
          map.setObject(map.wrapPosition({ x: nx, y: ny }), 'NONE');
          stack.push({ x: nx, y: ny });
          carved = true;
          break;
        }

        if (!carved) {
          stack.pop();
        }
      }
    };

    // 未訪問の奇数ノードをすべて掘り尽くす
    const oddNodes: Position[] = [];
    for (let y = y1; y <= y2; y++) {
      if (y % 2 !== 1) continue;
      for (let x = x1; x <= x2; x++) {
        if (x % 2 !== 1) continue;
        if (isCarvableNode(x, y)) {
          oddNodes.push({ x, y });
        }
      }
    }

    for (const node of rng.shuffle(oddNodes)) {
      if (visited[this.toIdx(node.x, node.y)]) continue;
      carveFrom(node.x, node.y);
    }

    // 3. ループ間引き（1マス厚の仕切り壁の約15%を開通し、回遊性を確保）
    const isWall = (x: number, y: number) => map.getObject(map.wrapPosition({ x, y })) === 'BLOCK';
    const isFloor = (x: number, y: number) => {
      const p = map.wrapPosition({ x, y });
      return map.getBaseTile(p) !== 'WALL_STATIC' && map.getObject(p) !== 'BLOCK';
    };

    const candidates: Position[] = [];
    for (let y = y1; y <= y2; y++) {
      for (let x = x1; x <= x2; x++) {
        const idx = this.toIdx(x, y);
        if (protectedMask[idx] || !isWall(x, y)) continue;
        const lrFloor = isFloor(x - 1, y) && isFloor(x + 1, y);
        const udWall = isWall(x, y - 1) && isWall(x, y + 1);
        const udFloor = isFloor(x, y - 1) && isFloor(x, y + 1);
        const lrWall = isWall(x - 1, y) && isWall(x + 1, y);
        if ((lrFloor && udWall) || (udFloor && lrWall)) {
          candidates.push({ x, y });
        }
      }
    }

    const shuffledCands = rng.shuffle(candidates);
    const targetOpen = Math.floor(shuffledCands.length * 0.22);
    let opened = 0;
    for (const c of shuffledCands) {
      if (opened >= targetOpen) break;
      map.setObject(map.wrapPosition(c), 'NONE');
      opened++;
    }
  }

  /**
   * 3. FORTRESS_ARENA: 中央/ドラゴン周囲に24x24〜32x32大広間＋トーチカ群、外周に城壁・小部屋帯
   */
  private static buildFortressArena(
    map: WorldMap,
    protectedMask: Uint8Array,
    portClearanceMask: Uint8Array,
    dragonCenter: Position,
    rng: SeedRandom
  ): void {
    const W = this.W;
    const arenaRadius = 13; // 27x27 の明確な大広間

    // 1. 城壁リング (radius 14) と外周小部屋・城壁グリッド (radius >= 16)
    for (let y = 0; y < W; y++) {
      for (let x = 0; x < W; x++) {
        if (!this.canPlaceBlock(map, protectedMask, portClearanceMask, x, y)) continue;

        const dist = map.getTorusDistance({ x, y }, dragonCenter);
        const r = dist.chebyshev;

        // サイン付きトーラス相対座標
        let dx = x - dragonCenter.x;
        if (dx > W / 2) dx -= W;
        if (dx < -W / 2) dx += W;
        let dy = y - dragonCenter.y;
        if (dy > W / 2) dy -= W;
        if (dy < -W / 2) dy += W;

        if (r === arenaRadius + 1) {
          // 城壁リング（4辺中央に幅3の城門＋斜め4隅に幅1の通用口）
          const isMainGate = Math.abs(dx) <= 1 || Math.abs(dy) <= 1;
          const isCornerGate = Math.abs(dx) >= r - 1 && Math.abs(dy) >= r - 1;
          if (!isMainGate && !isCornerGate) {
            map.setObject({ x, y }, 'BLOCK');
          }
        } else if (r === arenaRadius + 2) {
          // 二重城壁の一部（要塞感の強調：コーナーと一部のみ補強）
          const isCornerReinforce = Math.abs(dx) >= 8 && Math.abs(dy) >= 8 && (Math.abs(dx) + Math.abs(dy)) % 2 === 0;
          if (isCornerReinforce) {
            map.setObject({ x, y }, 'BLOCK');
          }
        } else if (r >= arenaRadius + 3) {
          // 外周の城塞小部屋帯（8x8 グリッド状の部屋壁＋各辺幅2の扉）
          const gx = ((x % 8) + 8) % 8;
          const gy = ((y % 8) + 8) % 8;
          const isWallLine = gx === 0 || gy === 0;
          const isDoor = (gx === 0 && (gy === 3 || gy === 4 || gy === 7)) || (gy === 0 && (gx === 3 || gx === 4 || gx === 7));
          if (isWallLine && !isDoor) {
            map.setObject({ x, y }, 'BLOCK');
          }
        }
      }
    }

    // 2. アリーナ内部 (radius 9..11) に十字型トーチカ群を配置（広間内の遮蔽・戦術拠点）
    const pillboxOffsets: Position[] = [
      { x: -10, y: -10 },
      { x: 10, y: -10 },
      { x: -10, y: 10 },
      { x: 10, y: 10 },
      { x: 0, y: -11 },
      { x: 0, y: 11 },
      { x: -11, y: 0 },
      { x: 11, y: 0 },
      { x: -10, y: -4 },
      { x: 10, y: -4 },
      { x: -10, y: 4 },
      { x: 10, y: 4 },
    ];
    const crossOffsets = [
      { dx: 0, dy: 0 },
      { dx: 1, dy: 0 },
      { dx: -1, dy: 0 },
      { dx: 0, dy: 1 },
      { dx: 0, dy: -1 },
    ];

    for (const off of pillboxOffsets) {
      if (!rng.chance(0.85)) continue;
      const cx = (dragonCenter.x + off.x + W) % W;
      const cy = (dragonCenter.y + off.y + W) % W;
      for (const co of crossOffsets) {
        const tx = (cx + co.dx + W) % W;
        const ty = (cy + co.dy + W) % W;
        if (this.canPlaceBlock(map, protectedMask, portClearanceMask, tx, ty)) {
          map.setObject({ x: tx, y: ty }, 'BLOCK');
        }
      }
    }
  }

  /**
   * 4. SPIRAL_LABYRINTH: ドラゴン中心を取り巻く同心／渦巻き回廊（2マス通路＋1マス壁リング）
   */
  private static buildSpiralLabyrinth(
    map: WorldMap,
    protectedMask: Uint8Array,
    portClearanceMask: Uint8Array,
    dragonCenter: Position,
    rng: SeedRandom
  ): void {
    const W = this.W;
    const startRadius = 6;
    const maxRadius = 31;

    // 層ごとのゲート方向（90度ずつ回転させて渦巻き導線を形成）
    const layerGateSide = new Map<number, number>();
    let layerIdx = 0;
    for (let r = startRadius; r <= maxRadius; r += 3) {
      layerGateSide.set(r, (layerIdx + rng.nextInt(0, 0)) % 4);
      layerIdx++;
    }

    for (let y = 0; y < W; y++) {
      for (let x = 0; x < W; x++) {
        if (!this.canPlaceBlock(map, protectedMask, portClearanceMask, x, y)) continue;

        const r = map.getTorusDistance({ x, y }, dragonCenter).chebyshev;
        if (r < startRadius || r > maxRadius) continue;

        if ((r - startRadius) % 3 !== 0) continue;

        let dx = x - dragonCenter.x;
        if (dx > W / 2) dx -= W;
        if (dx < -W / 2) dx += W;
        let dy = y - dragonCenter.y;
        if (dy > W / 2) dy -= W;
        if (dy < -W / 2) dy += W;

        const gateSide = layerGateSide.get(r) ?? 0;
        // 主ゲート（幅3）と対角補助ゲート（幅1）で渦巻き＋回遊性を両立
        const isMainGate =
          (gateSide === 0 && dy === -r && Math.abs(dx) <= 1) ||
          (gateSide === 1 && dx === r && Math.abs(dy) <= 1) ||
          (gateSide === 2 && dy === r && Math.abs(dx) <= 1) ||
          (gateSide === 3 && dx === -r && Math.abs(dy) <= 1);

        const oppSide = (gateSide + 2) % 4;
        const isSubGate =
          (oppSide === 0 && dy === -r && dx === 0) ||
          (oppSide === 1 && dx === r && dy === 0) ||
          (oppSide === 2 && dy === r && dx === 0) ||
          (oppSide === 3 && dx === -r && dy === 0);

        if (!isMainGate && !isSubGate) {
          map.setObject({ x, y }, 'BLOCK');
        }
      }
    }

    // 回廊途中に少数の障壁ピラーを追加して単調さを防ぐ
    for (let r = startRadius + 1; r < maxRadius; r += 3) {
      for (let i = 0; i < 4; i++) {
        if (!rng.chance(0.5)) continue;
        const offset = rng.nextInt(-Math.floor(r * 0.6), Math.floor(r * 0.6));
        let px = dragonCenter.x;
        let py = dragonCenter.y;
        if (i === 0) { px += offset; py -= r; }
        else if (i === 1) { px += r; py += offset; }
        else if (i === 2) { px += offset; py += r; }
        else { px -= r; py += offset; }
        const wp = map.wrapPosition({ x: px, y: py });
        if (this.canPlaceBlock(map, protectedMask, portClearanceMask, wp.x, wp.y)) {
          map.setObject(wp, 'BLOCK');
        }
      }
    }
  }

  /**
   * 5. MULTI_SECTOR: 4象限（32x32 × 4）ごとにスタイルを切り替え＋セクター隔壁
   */
  private static buildMultiSector(
    map: WorldMap,
    protectedMask: Uint8Array,
    portClearanceMask: Uint8Array,
    rng: SeedRandom
  ): void {
    const W = this.W;
    const half = W / 2; // 32

    // 1. 4象限境界にゲート付きセクター隔壁を構築
    for (let i = 0; i < W; i++) {
      // セクター内の中央付近 (15..16, 47..48) に幅2のゲート
      const isGate = (i >= 15 && i <= 16) || (i >= 47 && i <= 48);
      if (isGate) continue;

      const boundaryCoords = [
        { x: half - 1, y: i },
        { x: i, y: half - 1 },
        { x: W - 1, y: i },
        { x: i, y: W - 1 },
      ];
      for (const bp of boundaryCoords) {
        if (this.canPlaceBlock(map, protectedMask, portClearanceMask, bp.x, bp.y)) {
          map.setObject(bp, 'BLOCK');
          protectedMask[this.toIdx(bp.x, bp.y)] = 1;
        }
      }
    }

    // 2. 各セクター内部を異なるスタイルで生成（シードでスタイル順をローテーション）
    const sectors = [
      { x1: 0, y1: 0, x2: half - 2, y2: half - 2 },
      { x1: half, y1: 0, x2: W - 2, y2: half - 2 },
      { x1: 0, y1: half, x2: half - 2, y2: W - 2 },
      { x1: half, y1: half, x2: W - 2, y2: W - 2 },
    ];
    const styles = rng.shuffle(['PILLAR', 'MAZE', 'ARENA_PILLBOX', 'CHAMBERS'] as const);

    for (let s = 0; s < 4; s++) {
      const sec = sectors[s];
      const style = styles[s];
      if (style === 'PILLAR') {
        this.buildPillarGrid(map, protectedMask, portClearanceMask, rng, sec);
      } else if (style === 'MAZE') {
        this.buildNarrowMaze(map, protectedMask, portClearanceMask, rng, sec);
      } else if (style === 'ARENA_PILLBOX') {
        // 開放アリーナ＋十字トーチカ群
        const cx = Math.floor((sec.x1 + sec.x2) / 2);
        const cy = Math.floor((sec.y1 + sec.y2) / 2);
        const pts = [
          { x: cx - 6, y: cy - 6 },
          { x: cx + 6, y: cy - 6 },
          { x: cx - 6, y: cy + 6 },
          { x: cx + 6, y: cy + 6 },
          { x: cx, y: cy },
        ];
        for (const p of pts) {
          for (const d of [{ dx: 0, dy: 0 }, { dx: 1, dy: 0 }, { dx: -1, dy: 0 }, { dx: 0, dy: 1 }, { dx: 0, dy: -1 }]) {
            const tx = p.x + d.dx;
            const ty = p.y + d.dy;
            if (tx >= sec.x1 + 1 && tx <= sec.x2 - 1 && ty >= sec.y1 + 1 && ty <= sec.y2 - 1) {
              if (this.canPlaceBlock(map, protectedMask, portClearanceMask, tx, ty)) {
                map.setObject({ x: tx, y: ty }, 'BLOCK');
              }
            }
          }
        }
      } else {
        // CHAMBERS: 8x8 小部屋グリッド
        for (let y = sec.y1; y <= sec.y2; y++) {
          for (let x = sec.x1; x <= sec.x2; x++) {
            const lx = x - sec.x1;
            const ly = y - sec.y1;
            const isWall = lx % 7 === 0 || ly % 7 === 0;
            const isDoor = (lx % 7 === 0 && ly % 7 === 3) || (ly % 7 === 0 && lx % 7 === 3);
            if (isWall && !isDoor && this.canPlaceBlock(map, protectedMask, portClearanceMask, x, y)) {
              map.setObject({ x, y }, 'BLOCK');
            }
          }
        }
      }
    }
  }
}
