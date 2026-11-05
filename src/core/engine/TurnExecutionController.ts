import { DeathInfo, Direction, TileType } from '../../models/Types.js';
import { MovementSystem } from '../../systems/MovementSystem.js';
import { MagicSystem } from '../../systems/MagicSystem.js';
import { CombatSystem } from '../../systems/CombatSystem.js';
import { EnemyAISystem } from '../../systems/EnemyAISystem.js';
import { SpawnSystem } from '../../systems/SpawnSystem.js';
import { ChestSystem } from '../../systems/ChestSystem.js';
import { SystemSaveData } from '../../services/SaveManager.js';
import type { GameEngine } from '../GameEngine.js';

export class TurnExecutionController {
  private engine: GameEngine;

  constructor(engine: GameEngine) {
    this.engine = engine;
  }

  /**
   * 指定した魔法を直接発動（Botや外部入力用）
   */
  public castMagic(magicType: string): boolean {
    const player = this.engine.getPlayer();
    const unlocked = MagicSystem.getUnlockedMagics(player);
    const magicIndex = unlocked.findIndex(m => m.type === magicType);
    if (magicIndex === -1) {
      return false;
    }
    this.engine.setSelectedMagicIndex(magicIndex);
    this.castSelectedMagic();
    return true;
  }

  /**
   * 現在選択中の魔法を発動
   */
  public castSelectedMagic(): void {
    const player = this.engine.getPlayer();
    const domUI = this.engine.getDomUI();
    const unlocked = MagicSystem.getUnlockedMagics(player);
    if (unlocked.length === 0) {
      domUI?.addLog('習得している魔法がありません', 'warn');
      return;
    }

    let selectedIndex = this.engine.getSelectedMagicIndex();
    if (selectedIndex >= unlocked.length) {
      selectedIndex = 0;
      this.engine.setSelectedMagicIndex(0);
    }
    const magic = unlocked[selectedIndex];
    const renderer = this.engine.getRenderer();
    const systemInfo: SystemSaveData = {
      totalTurns: this.engine.getTotalTurns(),
      paletteMode: renderer ? renderer.getPalette().getMode() : 'NORMAL',
      selectedMagicIndex: selectedIndex,
      showMiniMap: this.engine.getShowMiniMap(),
      spawnTurnCounter: SpawnSystem.getTurnCounter(),
      tuningParams: this.engine.getActiveTuningParams(),
      isProceduralMode: this.engine.isProceduralModeState(),
      proceduralOptions: this.engine.getProceduralOptions(),
    };
    const result = MagicSystem.cast(
      player,
      magic.type,
      this.engine.getMap(),
      this.engine.getEnemies(),
      this.engine.getGhosts(),
      this.engine.getDragon(),
      systemInfo
    );

    this.engine.getEventBus().emit('magic:cast', {
      magicName: magic.name,
      cost: magic.cost,
      success: result.success,
      details: { type: magic.type },
    });

    if (result.success) {
      this.engine.incrementTotalTurns();
      const audio = this.engine.getAudio();
      const combatEffects = this.engine.getCombatEffects();

      if (magic.type === 'KICK') {
        if (result.kickPath) {
          combatEffects.triggerKickSlide(
            result.kickPath,
            result.kickHitEnemy?.pos,
            result.kickCrushed
          );
        }
        if (result.kickHitEnemy) {
          audio.playBumpCombat();
        } else {
          audio.playBreak();
        }
      } else if (magic.type === 'BREAK') {
        audio.playBreak();
      } else {
        audio.playMagicCast();
      }

      domUI?.addLog(result.message ?? `${magic.name}を発動した！`, 'magic');
      if (result.showMap) {
        this.engine.setShowMiniMap(true);
      }

      // 我が家帰還イベントの検知（RETURN魔法等）
      this.checkHomeReturnEvent();

      // 魔法発動でターンを消費
      this.engine.getTurnManager().reset();
      MagicSystem.updatePassiveSkills(player);
      this.executeEnemyTurn();

      // FREEZE / FLASH発動時、近隣の凍結モンスターがいればターゲット表示へ反映
      if (magic.type === 'FREEZE' || magic.type === 'FLASH') {
        const tracker = this.engine.getTargetTracker();
        const curTarget = tracker.getTargetEnemyInstance();
        if (!curTarget || !curTarget.isAlive) {
          const nearbyFrozen = this.engine.getEnemies().find(
            e =>
              e.isAlive &&
              e.isFrozen &&
              Math.abs(e.pos.x - player.pos.x) <= 1 &&
              Math.abs(e.pos.y - player.pos.y) <= 1
          );
          if (nearbyFrozen) {
            tracker.setTargetEnemyInstance(nearbyFrozen);
          }
        }
        this.engine.updateTargetTracking();
      }
    } else {
      domUI?.addLog(result.message ?? '魔法の発動に失敗しました', 'warn');
    }
  }

  /**
   * ターン実行（プレイヤー行動 -> 敵行動 & 墓スポーン）
   * @param dir 方向（null の場合は SPACEキー によるアクションまたはタイムアウト待機）
   * @param isTimeout タイムアウトによる自動パスかどうか
   */
  public executeTurn(dir: Direction | null, isTimeout: boolean = false): void {
    if (this.engine.getState() !== 'PLAYING') return;

    const player = this.engine.getPlayer();
    const map = this.engine.getMap();
    const enemies = this.engine.getEnemies();
    const dragon = this.engine.getDragon();
    const domUI = this.engine.getDomUI();
    const audio = this.engine.getAudio();
    const combatEffects = this.engine.getCombatEffects();
    const eventBus = this.engine.getEventBus();
    const targetTracker = this.engine.getTargetTracker();
    const tuningParams = this.engine.getActiveTuningParams();

    MagicSystem.updatePassiveSkills(player);

    let actionTaken = false;

    if (dir !== null) {
      const prevPos = { ...player.pos };
      // プレイヤー移動試行（敵・ドラゴンとの戦闘、岩の押し出し、ワープ等）
      const moved = MovementSystem.tryMove(
        player,
        dir,
        map,
        enemies,
        dragon,
        tuningParams.progressionConfig.expDefenseMitigationRatio,
        tuningParams.progressionConfig
      );
      if (moved) {
        actionTaken = true;

        eventBus.emit('player:move', {
          from: prevPos,
          to: { ...player.pos },
          dir,
          pushedObject: MovementSystem.lastPushed ?? undefined,
        });

        // ワープゾーン通過
        if (MovementSystem.lastWarped) {
          audio.playWarp();
          domUI?.addLog('ワープゾーンに入り、対向地点へテレポートした！', 'magic');
        }

        // 戦闘結果の判定と効果音・視覚エフェクト（交互バトル調停）
        if (MovementSystem.lastCombatResult) {
          const res = MovementSystem.lastCombatResult;
          const targetPos = res.targetPos ?? (res.enemy ? res.enemy.pos : (res.isDragonHead ? dragon.centerPos : player.pos));
          const flickerTargetId = res.dragonPart ? res.dragonPart.type : res.enemy?.id;

          let targetName = res.enemy?.displayName;
          if (!targetName && res.dragonPart) {
            switch (res.dragonPart.type) {
              case 'LEFT_HEAD': targetName = 'ドラゴンの左首'; break;
              case 'CENTER_HEAD': targetName = 'ドラゴンの中央首'; break;
              case 'RIGHT_HEAD': targetName = 'ドラゴンの右首'; break;
              default: targetName = 'ドラゴンの首'; break;
            }
          } else if (!targetName && res.isDragonHead) {
            targetName = 'ドラゴンの首';
          }

          if (res.attacked || res.enemyKilled) {
            eventBus.emit('combat:playerAttack', {
              attacker: player,
              target: res.enemy ?? res.dragonPart!,
              damage: res.damageToEnemy,
              killed: res.enemyKilled,
              expGained: res.expGained ?? 0,
            });

            if (res.isDragonHead && res.dragonPart && res.enemyKilled) {
              eventBus.emit('dragon:headKilled', {
                headType: res.dragonPart.type,
                remainingHeads: dragon.heads.filter(h => h.isAlive).length,
                turn: this.engine.getTotalTurns(),
              });
            }
          }

          if (res.enemyKilled) {
            audio.playBumpCombat();
            combatEffects.triggerPlayerAttack(targetPos, flickerTargetId, res.damageToEnemy, true);
            domUI?.addLog(
              `⚔ 攻撃命中！ ${targetName ? `${targetName}へ ` : ''}${res.damageToEnemy}ダメージを与えて撃破した！`,
              'success'
            );
            targetTracker.clear();

            // ドラゴン全首撃破時: お化けたちが王冠を掴んで四方へ散乱するシークエンス
            if (res.isDragonHead && dragon.isAllHeadsDefeated) {
              dragon.scatterCrownsWithGhosts(map, this.engine.getGhosts());
              domUI?.addLog(
                '👑 ドラゴン全首討伐！ ドラゴンの宝箱が開き、お化けたちが王冠を持ち去って四方へ散乱した！',
                'warn'
              );
            }
          } else if (res.attacked) {
            audio.playBumpCombat();
            combatEffects.triggerPlayerAttack(targetPos, flickerTargetId, res.damageToEnemy, false);
            const targetHp = res.enemy ? `${res.enemy.hp}/${res.enemy.maxHp}` : (res.dragonPart ? `${res.dragonPart.hp}/${res.dragonPart.maxHp}` : '');
            domUI?.addLog(
              `⚔ 体当たり攻撃命中！ ${targetName ?? '敵'}へ ${res.damageToEnemy}ダメージ！ ${targetHp ? `(残HP: ${targetHp})` : ''}`,
              'combat'
            );
            if (res.enemy) {
              targetTracker.setTargetEnemy(res.enemy, player, tuningParams);
            }
          }
        }

        // 我が家帰還イベントの検知
        this.checkHomeReturnEvent();
      }
    } else {
      if (isTimeout) {
        // タイムアウトによるパス待機
        actionTaken = true;
        domUI?.addLog('時間制限満了: 待機パス', 'info');
      } else {
        // SPACEキーによるアイテムアクション（拾う / 置く / 交換 / 宝箱解錠 / 待機）
        const spaceResult = MovementSystem.executeSpaceAction(player, map, {
          ghosts: this.engine.getGhosts(),
          resourceCapConfig: tuningParams.resourceCapConfig,
        });
        actionTaken = true;

        if (spaceResult.action === 'OPEN_CHEST') {
          audio.playUnlockChest();
          eventBus.emit('chest:open', {
            pos: { ...player.pos },
            stepMod8: player.stepCountSinceStone % 8,
            itemSpawned: (spaceResult.item as TileType) ?? 'POWER_STONE',
            cappedFallbackFrom: spaceResult.cappedFallbackFrom,
          });
        } else if (spaceResult.action === 'PICKUP') {
          audio.playPickup();
        } else if (spaceResult.action === 'SWAP' || spaceResult.action === 'DROP') {
          audio.playSwap();
        }

        const logType = spaceResult.action === 'WAIT' ? 'info' : 'success';
        domUI?.addLog(spaceResult.message, logType);
      }
    }

    if (actionTaken) {
      this.engine.incrementTotalTurns();
      // ターン終了時の魔法状態進行（FLY持続時間・パッシブ特技解放等。敵のfrozenTimer減衰はexecuteEnemyTurn内で実施）
      MagicSystem.onTurnEnd(player);

      // インジケーターリセット
      this.engine.getTurnManager().reset();

      // 敵AIターン行動
      this.executeEnemyTurn();

      // 死亡判定
      if (player.hp <= 0) {
        this.handleGameOver();
        return;
      }

      // ステージクリア判定
      if (player.isStageCleared) {
        this.handleStageClear();
        return;
      }
    }
  }

  public executeEnemyTurn(): void {
    const targetTracker = this.engine.getTargetTracker();
    CombatSystem.engagedEnemy = targetTracker.getTargetEnemyInstance();
    const dragon = this.engine.getDragon();
    const player = this.engine.getPlayer();
    const map = this.engine.getMap();
    const enemies = this.engine.getEnemies();
    const audio = this.engine.getAudio();
    const domUI = this.engine.getDomUI();
    const combatEffects = this.engine.getCombatEffects();
    const eventBus = this.engine.getEventBus();
    const tuningParams = this.engine.getActiveTuningParams();

    const prevFireballCount = dragon.fireballs.length;

    // 1. 敵AI思考と移動・攻撃 (移動速度制御 & 首討伐加速)
    EnemyAISystem.updateEnemies(
      enemies,
      player,
      map,
      dragon,
      tuningParams.progressionConfig.expDefenseMitigationRatio,
      this.engine.getRng()
    );

    // 敵からの反撃・攻撃結果をログ・効果音・視覚エフェクトに出力
    if (EnemyAISystem.lastCombatResults && EnemyAISystem.lastCombatResults.length > 0) {
      for (const combat of EnemyAISystem.lastCombatResults) {
        if (combat.attacked) {
          eventBus.emit('combat:enemyAttack', {
            enemy: combat.enemy!,
            damage: combat.damageToPlayer,
            mitigatedByExp: combat.mitigatedDamage ?? 0,
            killed: player.hp <= 0,
            specialEffects: combat.specialEffects,
          });

          // プレイヤーへの被弾・反撃エフェクト（赤フリッカー ＋ 被ダメ数値ポップアップ）
          combatEffects.triggerEnemyCounter(player.pos, combat.damageToPlayer);

          if (combat.damageToPlayer > 0) {
            audio.playDamage();
            domUI?.addLog(
              `☠ ${combat.enemy?.displayName ?? '敵'}の反撃！ ${combat.damageToPlayer}のダメージを受けた！`,
              'combat'
            );
          } else {
            domUI?.addLog(
              `🛡 ${combat.enemy?.displayName ?? '敵'}の反撃を完全に防御した！（被ダメ: 0）`,
              'info'
            );
          }

          if (combat.specialEffects && combat.specialEffects.length > 0) {
            for (const effect of combat.specialEffects) {
              domUI?.addLog(`⚠️ ${combat.enemy?.displayName ?? '敵'}: ${effect}`, 'warn');
            }
          }

          if (combat.enemy) {
            targetTracker.setTargetEnemy(combat.enemy, player, tuningParams);
          }
        }
      }
    }

    // 2. ドラゴンの火炎弾更新
    dragon.updateFireballs(player, map);

    // 新たに火炎弾が発射された場合は効果音
    if (dragon.fireballs.length > prevFireballCount) {
      audio.playFireball();
    }

    // 2-B. ドラゴンの首による隣接マスへの能動的近接直接攻撃
    // プレイヤーが非FLY状態かつ十字架未所持のとき、首の上下左右4方向隣接マス（宝箱上含む）に滞在していると首から直接攻撃を受ける
    if (!player.isFlying && player.holdItem !== 'CROSS') {
      const attackingHead = dragon.getAdjacentAttackingHead(player.pos, map);
      if (attackingHead) {
        const damage = Math.max(
          0,
          attackingHead.atk -
            player.getEffectiveDefense(
              tuningParams.progressionConfig.expDefenseMitigationRatio
            )
        );
        player.takeDamage(
          damage,
          {
            cause: 'DRAGON_HEAD',
            damage,
            dragonPartType: attackingHead.type,
          },
          this.engine.getTotalTurns()
        );

        // 戦闘エフェクト（プレイヤーへの赤フリッカー ＋ 被ダメ数値ポップアップ）
        combatEffects.triggerEnemyCounter(player.pos, damage);

        let headName = 'ドラゴンの首';
        if (attackingHead.type === 'LEFT_HEAD') headName = 'ドラゴンの左首';
        else if (attackingHead.type === 'CENTER_HEAD') headName = 'ドラゴンの中央首';
        else if (attackingHead.type === 'RIGHT_HEAD') headName = 'ドラゴンの右首';

        if (damage > 0) {
          audio.playDamage();
          domUI?.addLog(
            `☠ ${headName}の猛攻撃！ ${damage}のダメージを受けた！`,
            'combat'
          );
        } else {
          domUI?.addLog(
            `🛡 ${headName}の攻撃を完全に防御した！（被ダメ: 0）`,
            'info'
          );
        }

        // ターゲット情報に対峙首をセット
        targetTracker.setTargetInfo(targetTracker.createTargetDragonInfo(attackingHead, player, tuningParams));
      }
    }

    // 3. 墓からの敵スポーン試行（ドラゴン世界変化対応）
    const spawnedEnemies = SpawnSystem.onTurnEnd(
      enemies,
      player,
      map,
      dragon,
      tuningParams,
      this.engine.getRng(),
      this.engine.getTotalTurns()
    );
    for (const e of spawnedEnemies) {
      const isHome = Math.abs(e.pos.x - map.homePos.x) <= 1 && Math.abs(e.pos.y - map.homePos.y) <= 1;
      if (isHome) {
        eventBus.emit('spawn:home', {
          pos: { ...e.pos },
          headsKilled: dragon.defeatedHeadsCount,
          success: true,
          blockedByCap: false,
          usedReserveSlot: true,
          evictedDistantEnemy: false,
        });
      } else {
        eventBus.emit('spawn:grave', {
          pos: { ...e.pos },
          enemyTypeId: e.typeId,
          success: true,
          blockedByCap: false,
        });
      }
    }
  }

  /**
   * 我が家（HOME）帰還イベントの検知とUIフィードバック
   */
  public checkHomeReturnEvent(): void {
    if (MovementSystem.lastHomeEvent) {
      const home = MovementSystem.lastHomeEvent;
      const player = this.engine.getPlayer();
      const domUI = this.engine.getDomUI();

      this.engine.getEventBus().emit('player:homeReturn', {
        result: home,
        turn: this.engine.getTotalTurns(),
        playerStr: player.strength,
        playerExp: player.experience,
      });

      this.engine.getAudio().playHomeHeal();
      let msg = `我が家に帰還！ HPが全快（EXP基準: ${home.newHp.toLocaleString()}）した！`;
      if (home.goldConverted > 0) {
        msg += ` 所持コイン${home.goldConverted}枚を奉納！ HP+${home.goldBonusHp.toLocaleString()}上乗せ`;
        if (home.goldExpGained > 0) {
          msg += `＆EXP+${home.goldExpGained.toLocaleString()}獲得！`;
        } else {
          msg += `！`;
        }
      }
      if (home.powerStoneConverted) {
        msg += ` パワーストーンを奉納しSTR+${home.strGained}！`;
      }
      if (home.deathPurified) {
        msg += ` 我が家の神聖な力により死神が浄化された！`;
      }
      if (home.crownConverted) {
        msg += ` 王冠を我が家に奉納した！（${player.crowns} / 4）`;
      }
      if (home.stageCleared) {
        msg += ` 4つの王冠をすべて奉納！ 見事に全制覇！`;
      }
      domUI?.addLog(msg, 'success');
      MovementSystem.lastHomeEvent = null;

      // 枯渇防止: 帰還時にマップ上の宝箱が少なくなっていれば自動補充 (Phase 8仕様)
      const replenished = ChestSystem.replenishChestsIfNeeded(
        this.engine.getMap(),
        player.pos,
        this.engine.getDragon().centerPos,
        10,
        18,
        this.engine.getRng()
      );
      if (replenished > 0) {
        domUI?.addLog(
          `📦 ダンジョン各地に新たな宝箱（+${replenished}個）が出現した！`,
          'info'
        );
      }
    }
  }

  public handleGameOver(overrideDeathInfo?: DeathInfo): void {
    this.engine.setState('GAMEOVER');
    CombatSystem.clearEngagedEnemy();
    this.engine.getTargetTracker().clear();
    this.engine.getAudio().playGameOver();

    const player = this.engine.getPlayer();
    const totalTurns = this.engine.getTotalTurns();

    if (overrideDeathInfo) {
      player.deathInfo = overrideDeathInfo;
    } else if (!player.deathInfo) {
      player.recordDeath(0, { cause: 'UNKNOWN' }, totalTurns);
    }

    if (player.deathInfo && player.deathInfo.turn === undefined) {
      player.deathInfo.turn = totalTurns;
    }

    const deathInfo = player.deathInfo;
    const domUI = this.engine.getDomUI();

    // 致命傷ログの強調表示
    if (deathInfo) {
      domUI?.addLog(`☠ 【致命傷】${deathInfo.message}`, 'fatal');
    }
    domUI?.addLog('☠ 勇者は力尽きた… GAME OVER', 'warn');
    domUI?.setGameState('GAMEOVER', player, player.totalKills, totalTurns);
  }

  public handleStageClear(): void {
    this.engine.setState('STAGECLEAR');
    CombatSystem.clearEngagedEnemy();
    this.engine.getTargetTracker().clear();
    this.engine.getAudio().playClearFanfare();

    const player = this.engine.getPlayer();
    const domUI = this.engine.getDomUI();
    domUI?.setGameState('STAGECLEAR', player, player.totalKills);
    domUI?.addLog('★ STAGE CLEAR! 4つの王冠をすべて家に持ち帰った！ ★', 'success');
  }
}
