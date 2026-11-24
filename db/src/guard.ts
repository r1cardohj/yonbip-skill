// SELECT 放行，其余一律拒绝；query 命令靠这层保证只读。
// 拦截规则：首关键字必须是 select/with/explain/show；禁止多语句；禁止 select into。
// 分号检测要跳过字符串字面量（'...'）和行注释（--），否则会误伤正常 SQL。
const READ_FIRST = /^\s*(select|with|explain|show)\b/i;

function stripCommentsAndStrings(sql: string): string {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (ch === "-" && next === "-") {
      while (i < sql.length && sql[i] !== "\n") i++;
    } else if (ch === "'") {
      i++; // 跳过开引号
      while (i < sql.length) {
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") i += 2; // 转义 '' 
          else {
            i++;
            break;
          }
        } else i++;
      }
      out += "''";
      continue;
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

export function assertReadOnly(sql: string): void {
  if (!READ_FIRST.test(sql)) {
    throw new Error("query 只允许只读语句（SELECT/WITH/EXPLAIN），写操作请用 exec --confirm");
  }
  const cleaned = stripCommentsAndStrings(sql);
  const parts = cleaned.split(";").map((s) => s.trim()).filter(Boolean);
  if (parts.length > 1) {
    throw new Error("不允许一次提交多条语句");
  }
  if (/^\s*select\b[\s\S]*\binto\b/i.test(parts[0])) {
    throw new Error("SELECT ... INTO 会建表，属于写操作，请用 exec --confirm");
  }
}
