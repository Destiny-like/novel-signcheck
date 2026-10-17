/* Phase 2a · 规则库版本化
 * 每张平台策略卡带 policy_version + effective_date；
 * effective_date 距今超过 90 天 → 过期预警（v1 设计的政策生命线）。
 */

export const POLICY_TTL_DAYS = 90;

export function policyAgeDays(platform) {
  const d = new Date(platform.effective_date + "T00:00:00");
  if (isNaN(d)) return 0;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

export function policyStatus(platform) {
  const age = policyAgeDays(platform);
  if (age > POLICY_TTL_DAYS) return { level: "expired", age };
  if (age > POLICY_TTL_DAYS - 30) return { level: "aging", age };
  return { level: "ok", age };
}

export function policyWarnHtml(platform) {
  const st = policyStatus(platform);
  if (st.level === "ok") return "";
  if (st.level === "expired") {
    return `<div class="pol-warn expired">⚠ 该策略卡已 ${st.age} 天未更新（超过 90 天有效期），签约前请以平台官方最新公告为准</div>`;
  }
  return `<div class="pol-warn aging">⏳ 该策略卡已 ${st.age} 天未更新，距 90 天有效期不足 30 天</div>`;
}
