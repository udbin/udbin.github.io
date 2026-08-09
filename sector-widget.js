// sector-widget.js
// 섹터별 공포탐욕지수 카드 위젯 (반도체/2차전지/바이오/방산)
// index.html에서 아래 2줄만 있으면 자동으로 이 위젯이 렌더링됩니다:
//   <div id="sector-widget-root"></div>
//   <script src="/sector-widget.js"></script>
//
// index.html을 나중에 수정하실 때 이 2줄만 안 지우시면 됩니다.

(function () {
  const CSS = `
    .sector-section{margin:32px 0;}
    .sector-title{font-family:'JetBrains Mono',monospace;font-size:12px;letter-spacing:2px;color:var(--muted,#5a7090);text-transform:uppercase;margin-bottom:14px;text-align:center;}
    .sector-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:18px;max-width:1200px;margin:0 auto;}
    .sector-card{background:var(--surface,#0f1520);border:1px solid var(--border,#1e2a3a);padding:26px 16px;text-align:center;text-decoration:none;transition:border-color .2s,transform .15s;cursor:pointer;}
    .sector-card:hover{border-color:var(--accent,#4a9eff);transform:translateY(-2px);}
    .sector-name{font-size:16px;color:var(--text,#e8edf5);font-weight:700;margin-bottom:10px;}
    .sector-score{font-family:'Bebas Neue',sans-serif;font-size:48px;line-height:1;}
    .sector-label{font-family:'JetBrains Mono',monospace;font-size:12px;font-weight:700;margin-top:6px;letter-spacing:1px;}
    .sector-updated{font-size:11px;color:var(--muted,#5a7090);margin-top:8px;font-family:'JetBrains Mono',monospace;}
    .sector-note{max-width:1200px;margin:14px auto 0;text-align:center;font-size:12px;color:var(--muted,#5a7090);line-height:1.6;}
    @media(max-width:600px){ .sector-grid{grid-template-columns:repeat(2,1fr);} }
  `;

  const SECTOR_META = {
    semi:    { name: '반도체' },
    battery: { name: '2차전지' },
    bio:     { name: '바이오' },
    defense: { name: '방산' },
  };

  function scoreColor(score) {
    if (score < 25) return '#ff2d55';
    if (score < 45) return '#ff6b35';
    if (score < 55) return '#ffd60a';
    if (score < 75) return '#30d158';
    return '#0aff9d';
  }
  function scoreLabel(score) {
    if (score < 25) return '😱 극단적공포';
    if (score < 45) return '😰 공포';
    if (score < 55) return '😐 중립';
    if (score < 75) return '😎 탐욕';
    return '🚀 극단탐욕';
  }

  async function renderSectorWidget() {
    const root = document.getElementById('sector-widget-root');
    if (!root) return; // 이 div가 없는 페이지에선 조용히 아무것도 안 함

    // CSS 주입 (한 번만)
    if (!document.getElementById('sector-widget-style')) {
      const styleTag = document.createElement('style');
      styleTag.id = 'sector-widget-style';
      styleTag.textContent = CSS;
      document.head.appendChild(styleTag);
    }

    root.innerHTML = `
      <div class="sector-section">
        <div class="sector-title">📊 국내 섹터별 공포탐욕지수</div>
        <div class="sector-grid" id="sectorGrid"></div>
        <div class="sector-note">섹터별 시가총액 상위 10개 종목 기준으로 산출되며, 하루 2회(장 시작 후·장 마감 후) 자동 갱신됩니다.</div>
      </div>
    `;

    const grid = document.getElementById('sectorGrid');
    grid.innerHTML = Object.keys(SECTOR_META).map(key =>
      `<div class="sector-card" data-key="${key}">
         <div class="sector-name">${SECTOR_META[key].name}</div>
         <div class="sector-score" style="color:var(--muted,#5a7090);">--</div>
         <div class="sector-label" style="color:var(--muted,#5a7090);">로딩중</div>
       </div>`
    ).join('');

    try {
      const res = await fetch('https://feargree-api.vercel.app/api/sectors-summary');
      const data = await res.json();

      Object.keys(SECTOR_META).forEach(key => {
        const card = grid.querySelector(`[data-key="${key}"]`);
        const info = data.sectors && data.sectors[key];
        if (!info) {
          card.querySelector('.sector-score').textContent = 'N/A';
          return;
        }
        const color = scoreColor(info.score);
        card.querySelector('.sector-score').style.color = color;
        card.querySelector('.sector-score').textContent = info.score;
        card.querySelector('.sector-label').style.color = color;
        card.querySelector('.sector-label').textContent = scoreLabel(info.score);

        const updated = document.createElement('div');
        updated.className = 'sector-updated';
        updated.textContent = info.updatedAt
          ? new Date(info.updatedAt).toLocaleString('ko-KR', { hour: '2-digit', minute: '2-digit' }) + ' 갱신'
          : '';
        card.appendChild(updated);
      });
    } catch (e) {
      console.warn('섹터 데이터 로드 실패:', e.message);
    }

    grid.querySelectorAll('.sector-card').forEach(card => {
      card.addEventListener('click', () => {
        const key = card.getAttribute('data-key');
        window.location.href = `/sector-detail.html?sector=${key}`;
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderSectorWidget);
  } else {
    renderSectorWidget();
  }
})();
