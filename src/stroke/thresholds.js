/**
 * src/stroke/thresholds.js —— 形状判定全部阈值（tech-baseline 第 5 节）
 * 硬规则：阈值只许出现在这里，禁止散落到 classify / body-factory 里。
 * 每个值后面 [待实测标定]，标定后直接改这里。
 */
export const SAMPLE_MIN_DIST = 2;        // S2 采样距离 CSS px              [待实测标定]
export const STROKE_MAX_POINTS = 400;    // S2 单笔采样上限                  [待实测标定]
export const FREEZE_IDLE_MS = 2000;      // S3 静默冻结                       [待实测标定]
export const RDP_EPSILON = 1.2;          // S4 RDP 简化容差 px                [待实测标定]
export const SIMPLIFY_MAX_NODES = 120;   // S4 简化后节点上限
export const CLOSE_TOL_MIN = 8;          // S5 闭合容差下限 px                [待实测标定]
export const CLOSE_TOL_RATIO = 0.18;     // S5 闭合容差 = 0.18 × 短边          [待实测标定]
export const MIN_STROKE_LENGTH = 8;      // S9 单点/极小拒判长度 px            [待实测标定]
export const MIN_STROKE_AREA = 60;       // S9 颗粒面积阈值 px²                [待实测标定]
export const ASPECT_WHEEL_MAX = 1.5;     // 轮/团块分界                        [待实测标定]
export const ASPECT_BLOB_MAX = 3.0;      // 团块/长闭合分界                    [待实测标定]
export const ASPECT_BEAM_MIN = 6.0;      // 梁长宽比阈值                       [待实测标定]
export const HOLE_AREA_RATIO = 0.15;     // 容器孔面积比                       [待实测标定]
export const DECOMP_MAX_PARTS = 8;       // 拆凸块上限                         [待实测标定]
export const SUBMIT_COOLDOWN_MS = 150;   // 提交冷却                            [待实测标定]
export const MAX_ABILITIES_PER_CREATURE = 2; // S12 单造物能力上限
export const ROPE_JOINT_MAX = 8;         // 绳：最多 8 节
