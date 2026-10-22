/**
 * 코스피·코스닥 지수를 한국투자증권(KIS) Open API에서 가져와 market.json으로 저장합니다.
 * GitHub Actions(.github/workflows/market-data.yml)에서 5분마다 실행됩니다.
 *
 * 필요한 환경변수 (GitHub 저장소 Settings → Secrets and variables → Actions 에 등록)
 *   KIS_APP_KEY     : KIS 앱키
 *   KIS_APP_SECRET  : KIS 앱시크릿
 *
 * 사용법: node scripts/fetch-market.mjs <출력파일> [이전파일]
 *   - 이전파일과 지수 값이 같으면 출력파일을 만들지 않습니다 (불필요한 커밋 방지).
 *
 * 접근토큰은 하루(24시간) 유효하므로 매번 새로 받지 않고,
 * 앱시크릿으로 암호화한 뒤 .kis-token.enc 파일로 Actions 캐시에 보관해 재사용합니다.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';

const BASE = process.env.KIS_BASE_URL || 'https://openapi.koreainvestment.com:9443';
const APP_KEY = process.env.KIS_APP_KEY;
const APP_SECRET = process.env.KIS_APP_SECRET;
const TOKEN_FILE = '.kis-token.enc';

const [, , outPath = 'market.json', prevPath] = process.argv;

if (!APP_KEY || !APP_SECRET) {
  console.error('❌ KIS_APP_KEY / KIS_APP_SECRET 이 설정되지 않았습니다. 저장소 Secrets를 확인하세요.');
  process.exit(1);
}

// ── GitHub Actions 출력값 기록 ──
function setOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

// ── 토큰 암호화 보관 (앱시크릿 없이는 복호화 불가) ──
const KEY = crypto.createHash('sha256').update(APP_SECRET).digest();
function encrypt(obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const data = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), data]).toString('base64');
}
function decrypt(b64) {
  const buf = Buffer.from(b64, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', KEY, buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return JSON.parse(Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8'));
}

async function getToken() {
  // 1) 캐시된 토큰이 1시간 이상 남아 있으면 재사용
  try {
    const cached = decrypt(fs.readFileSync(TOKEN_FILE, 'utf8'));
    if (cached.token && cached.expiresAt - Date.now() > 60 * 60 * 1000) {
      console.log('🔑 저장된 접근토큰 재사용');
      setOutput('token_refreshed', 'false');
      return cached.token;
    }
  } catch { /* 캐시 없음 또는 손상 → 새로 발급 */ }

  // 2) 새로 발급
  const res = await fetch(`${BASE}/oauth2/tokenP`, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ grant_type: 'client_credentials', appkey: APP_KEY, appsecret: APP_SECRET }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) {
    throw new Error(`토큰 발급 실패 (HTTP ${res.status}): ${json.error_description || json.msg1 || JSON.stringify(json)}`);
  }
  const expiresAt = Date.now() + (Number(json.expires_in) || 86400) * 1000;
  fs.writeFileSync(TOKEN_FILE, encrypt({ token: json.access_token, expiresAt }));
  console.log('🔑 접근토큰 새로 발급');
  setOutput('token_refreshed', 'true');
  return json.access_token;
}

// ── 업종 현재지수 조회 (0001=코스피, 1001=코스닥) ──
async function getIndex(token, code, name) {
  const url = new URL(`${BASE}/uapi/domestic-stock/v1/quotations/inquire-index-price`);
  url.searchParams.set('FID_COND_MRKT_DIV_CODE', 'U');
  url.searchParams.set('FID_INPUT_ISCD', code);

  const res = await fetch(url, {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      authorization: `Bearer ${token}`,
      appkey: APP_KEY,
      appsecret: APP_SECRET,
      tr_id: 'FHPUP02100000',
      custtype: 'P',
    },
  });
  const json = await res.json().catch(() => ({}));
  const o = json.output;
  if (!res.ok || json.rt_cd !== '0' || !o) {
    throw new Error(`${name} 조회 실패 (HTTP ${res.status}): ${json.msg1 || JSON.stringify(json)}`);
  }

  const value = Number(o.bstp_nmix_prpr);
  let change = Number(o.bstp_nmix_prdy_vrss);
  let changePct = Number(o.bstp_nmix_prdy_ctrt);
  // 부호: 1 상한 · 2 상승 · 3 보합 · 4 하한 · 5 하락 → 하락이면 음수로 맞춤
  const sign = String(o.prdy_vrss_sign || '');
  if (sign === '4' || sign === '5') { change = -Math.abs(change); changePct = -Math.abs(changePct); }
  if (sign === '3') { change = 0; changePct = 0; }
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} 지수 값 이상: ${o.bstp_nmix_prpr}`);

  return {
    name,
    value: Number(value.toFixed(2)),
    change: Number((Number.isFinite(change) ? change : 0).toFixed(2)),
    changePct: Number((Number.isFinite(changePct) ? changePct : 0).toFixed(2)),
    rising: Number(o.ascn_issu_cnt) || null,
    falling: Number(o.down_issu_cnt) || null,
  };
}

function kstString(d = new Date()) {
  return new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ');
}

async function main() {
  const token = await getToken();
  const kospi = await getIndex(token, '0001', '코스피');
  await new Promise(r => setTimeout(r, 300)); // 초당 호출 제한 여유
  const kosdaq = await getIndex(token, '1001', '코스닥');

  // 이전 값과 같으면 저장 생략 (장 마감 후·휴장일에 커밋이 쌓이지 않게)
  if (prevPath && fs.existsSync(prevPath)) {
    try {
      const prev = JSON.parse(fs.readFileSync(prevPath, 'utf8'));
      const same = ['kospi', 'kosdaq'].every(k =>
        prev.indices?.[k]?.value === { kospi, kosdaq }[k].value &&
        prev.indices?.[k]?.changePct === { kospi, kosdaq }[k].changePct);
      if (same) {
        console.log(`⏸ 변동 없음 — 코스피 ${kospi.value} / 코스닥 ${kosdaq.value}`);
        setOutput('changed', 'false');
        return;
      }
    } catch { /* 이전 파일 손상 → 새로 저장 */ }
  }

  const now = new Date();
  const out = {
    source: 'KIS',
    updatedAt: now.toISOString(),
    updatedAtKst: kstString(now),
    indices: { kospi, kosdaq },
  };
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n');
  console.log(`✅ 저장 완료 — 코스피 ${kospi.value} (${kospi.changePct}%) / 코스닥 ${kosdaq.value} (${kosdaq.changePct}%)`);
  setOutput('changed', 'true');
}

main().catch(err => {
  console.error('❌', err.message);
  process.exit(1);
});
