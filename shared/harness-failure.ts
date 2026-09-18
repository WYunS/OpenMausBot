/** Stable Harness LlmFailure codes/status, never inferred from prose or USD budgets. */
export interface HarnessDenial {
  kind: "authorization" | "quota" | "payment";
  code: string;
  retryable: false;
}

export function harnessDenial(value: unknown): HarnessDenial | undefined {
  if (!value || typeof value !== "object") return undefined;
  const { code, status } = value as { code?: unknown; status?: unknown };
  if (code === "AUTH" || status === 401 || status === 403) return { kind: "authorization", code: typeof code === "string" ? code : `HTTP_${status}`, retryable: false };
  if (code === "QUOTA") return { kind: "quota", code, retryable: false };
  if (status === 402 || code === "HTTP_402") return { kind: "payment", code: "HTTP_402", retryable: false };
  return undefined;
}

export function harnessDenialMessage(denial: HarnessDenial): string {
  return denial.kind === "authorization"
    ? "企业登录或模型授权被拒绝。请重新登录锐捷Bot；如仍失败，请联系管理员检查账号权限。任务未自动重试。"
    : denial.kind === "quota"
      ? "企业服务返回额度不足。请在账号页核对余额或联系管理员补充额度，再手动继续；Bot 不会自动重试，也不会把余额未知当成零。"
      : "企业服务返回付费限制。请在账号页核对账务状态或联系管理员，处理后再手动继续；任务未自动重试。";
}
