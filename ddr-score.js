/**
 * DDR スコア表示 (3icecream 難易度表にスコアとランクを重ねて表示する)
 *
 * 使い方: 難易度表ページ (https://3icecream.com/difficulty_list/18 など) で
 *        ブックマークレットから window.DDRScore() を呼び出す。
 */
window.DDRScore = async () => {
  // ------------------------------------------------------------
  // 設定
  // ------------------------------------------------------------
  const STATUS_ID = 'my-ddr-status'; // 進捗バナーの id
  const TOGGLE_ID = 'my-ddr-toggle'; // ランク表示トグルの id
  const STORAGE_KEY = 'ddrRankHidden'; // トグル状態の保存キー
  const BAND_HEIGHT = 28; // スコア黒帯の高さ(px)
  const SCORE_FONT_SIZE = 19; // スコア文字サイズ(px)
  const MIN_FONT_SIZE = 11; // 自動縮小の下限(px)
  const RANK_FONT_SIZE = 21; // ランク文字サイズ(px)
  const IMAGE_CONCURRENCY = 6; // ジャケット画像の同時確認数
  const SCORE_TIMEOUT_MS = 30000; // スコア取得のタイムアウト

  // スコアの数字の色 (ランクとは別の4段階)
  const scoreColor = (n) =>
    n >= 990000 ? '#FF2948' :
    n >= 950000 ? '#FFA273' :
    n >= 900000 ? '#FFFF70' :
    '#AFD18A';

  // ランク判定表: [下限スコア, 文字, 符号]
  const RANKS = [
    [990000, 'AAA', ''],
    [950000, 'AA', '+'],
    [900000, 'AA', ''],
    [890000, 'AA', '−'],
    [850000, 'A', '+'],
    [800000, 'A', ''],
    [790000, 'A', '−'],
    [750000, 'B', '+'],
    [700000, 'B', ''],
    [690000, 'B', '−'],
    [650000, 'C', '+'],
    [600000, 'C', ''],
    [590000, 'C', '−'],
    [550000, 'D', '+'],
    [0, 'D', ''],
  ];
  const rankOf = (n) => RANKS.find((r) => n >= r[0]);

  // ランク文字の色 (単色。html2canvas の「画像で保存」でも崩れない)
  const RANK_COLOR = {
    AAA: '#ffe680', // 明るい金
    AA: '#f5c518', // 濃い金
    A: '#fff04d', // 黄
    B: '#4db8ff', // 青
    C: '#ff6ec7', // ピンク
    D: '#b8b8b8', // 灰
  };

  // ランク文字の黒い縁取り (text-shadow なら html2canvas でも描画できる)
  const RANK_OUTLINE = [
    '1px 0 0 #000', '-1px 0 0 #000', '0 1px 0 #000', '0 -1px 0 #000',
    '1px 1px 0 #000', '-1px -1px 0 #000', '1px -1px 0 #000', '-1px 1px 0 #000',
  ].join(',');

  // ------------------------------------------------------------
  // 前回の表示を片付ける
  // ------------------------------------------------------------
  document.getElementById(STATUS_ID)?.remove();
  document.getElementById(TOGGLE_ID)?.remove();

  let showRank = true;
  try {
    showRank = localStorage.getItem(STORAGE_KEY) !== '1';
  } catch (e) {
    /* localStorage が使えない環境では常に ON */
  }

  // ------------------------------------------------------------
  // 進捗バナー
  // ------------------------------------------------------------
  const el = (tag, css, text) => {
    const e = document.createElement(tag);
    e.style.cssText = css;
    if (text) e.textContent = text;
    return e;
  };

  const box = el(
    'div',
    [
      'position:fixed', 'top:12px', 'right:12px', 'z-index:2147483647',
      'width:300px', 'max-width:calc(100vw - 24px)', 'box-sizing:border-box',
      'padding:12px 28px 12px 14px', 'border-radius:8px',
      'background:#1f2029', 'color:#fff', 'font:13px/1.6 sans-serif',
      'box-shadow:0 4px 16px rgba(0,0,0,.5)', 'border-left:4px solid #4da3ff',
    ].join(';')
  );
  box.id = STATUS_ID;

  const head = el('div', 'font-weight:700;font-size:14px;margin-bottom:4px', 'DDRスコア表示');
  const line = el('div', 'white-space:pre-line');
  const track = el('div', 'height:4px;margin-top:8px;border-radius:2px;background:#444;overflow:hidden');
  const bar = el('div', 'height:4px;width:0;background:#4da3ff;transition:width .2s');
  track.appendChild(bar);

  const closeButton = el(
    'button',
    'position:absolute;top:4px;right:6px;border:0;background:none;color:#aaa;font-size:18px;cursor:pointer;line-height:1',
    '×'
  );
  closeButton.onclick = () => box.remove();

  box.append(head, line, track, closeButton);
  document.body.appendChild(box);

  // stopped: 警告やエラーで中断した後、進捗表示が上書きされないようにするフラグ
  let stopped = false;

  // p: 進捗 0〜1 (null なら進捗バーを隠す)
  const show = (text, color, p) => {
    line.textContent = text;
    box.style.borderLeftColor = color;
    if (p == null) track.style.display = 'none';
    else bar.style.width = Math.round(p * 240) + 'px';
  };

  // ------------------------------------------------------------
  // メイン処理
  // ------------------------------------------------------------
  let frame;
  try {
    // --- 実行ページの確認 ---
    const pathMatch = location.pathname.match(/^\/difficulty_list\/(\d+)/);
    if (!pathMatch) {
      throw Error('難易度表のページ\n（3icecream.com/difficulty_list/18 など）\nで実行してください');
    }
    const level = pathMatch[1];

    // 前回追加した要素を消す
    document.querySelectorAll('.my-ddr-score').forEach((e) => e.remove());
    window.__ddrScoreObjectUrls = window.__ddrScoreObjectUrls || [];

    const images = [...document.querySelectorAll('.div-jacket img.img-jacket')];

    // --- 進捗表示 ---
    let scoreMsg = '読み込み中…';
    let scoreFrac = 0;
    let imgDone = 0;
    let fixed = 0;

    const render = () => {
      if (stopped) return;
      const imgFrac = images.length ? imgDone / images.length : 1;
      show(
        '① スコア取得: ' + scoreMsg + '\n② ジャケット確認: ' + imgDone + '/' + images.length,
        '#4da3ff',
        scoreFrac * 0.5 + imgFrac * 0.5
      );
    };
    render();

    // --- スコアページを裏で開く ---
    frame = document.createElement('iframe');
    frame.style.cssText =
      'position:fixed;left:-10000px;top:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none';
    frame.src = '/ddr/home/' + level;
    document.body.appendChild(frame);

    // スコア行(tr.tr-score)が出現するまで待つ
    const getRows = () =>
      new Promise((resolve, reject) => {
        let elapsed = 0;
        const timer = setInterval(() => {
          try {
            const doc = frame.contentDocument;
            if (!doc) throw Error('スコアページを読み込めません');

            const found = doc.querySelectorAll('tr.tr-score[id]');
            if (found.length) {
              clearInterval(timer);
              scoreMsg = '完了（' + found.length + '譜面）';
              scoreFrac = 1;
              render();
              resolve([...found]);
              return;
            }

            elapsed += 250;
            scoreMsg = '読み込み中… ' + Math.floor(elapsed / 1000) + '秒';
            render();
            if (elapsed >= SCORE_TIMEOUT_MS) {
              clearInterval(timer);
              reject(Error(
                'スコアを取得できませんでした。\n・3icecreamにログインしているか\n・スコアが登録されているか\nを確認してください'
              ));
            }
          } catch (e) {
            clearInterval(timer);
            reject(e);
          }
        }, 250);
      });

    // --- ジャケット画像: 壊れているものだけ再取得する ---
    const checkImage = async (img) => {
      try {
        if (stopped) return;

        // 読み込み中なら最大3秒待つ
        if (!img.complete) {
          await new Promise((resolve) => {
            const timer = setTimeout(resolve, 3000);
            const done = () => {
              clearTimeout(timer);
              resolve();
            };
            img.addEventListener('load', done, { once: true });
            img.addEventListener('error', done, { once: true });
          });
        }
        if (stopped) return;

        // 正常に表示できていれば何もしない
        if (img.complete && img.naturalWidth > 0) return;

        // 壊れている場合は fetch し直して Blob URL を差し替える
        const original = img.dataset.ddrOriginalSrc || img.getAttribute('src');
        if (!original) return;
        img.dataset.ddrOriginalSrc = original;

        const response = await fetch(new URL(original, location.href).href, {
          credentials: 'same-origin',
          cache: 'no-store',
        });
        if (!response.ok) throw Error('HTTP ' + response.status);

        // Blob URL だと「画像で保存」(html2canvas)が読めないため、data URL にする
        const blob = await response.blob();
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        });
        img.src = dataUrl;
        await img.decode();
        fixed++;
      } catch (e) {
        console.warn('ジャケット画像復旧失敗:', img.src, e);
      } finally {
        imgDone++;
        render();
      }
    };

    const restoreImages = async () => {
      let index = 0;
      const worker = async () => {
        while (index < images.length && !stopped) {
          await checkImage(images[index++]);
        }
      };
      await Promise.all(Array.from({ length: IMAGE_CONCURRENCY }, worker));
    };

    // 画像確認はスコア取得と並行して走らせる
    const imagesPromise = restoreImages();
    imagesPromise.catch(() => {});

    const rows = await getRows();

    // --- SP/DP の不一致チェック (スコア取得直後に行う) ---
    const rowNums = new Set();
    const jacketNums = new Set();
    rows.forEach((r) => {
      const x = r.id.match(/-d(\d+)$/);
      if (x) rowNums.add(x[1]);
    });
    document.querySelectorAll('.div-jacket[id^="div-jacket-"]').forEach((j) => {
      const x = j.id.match(/-(\d+)$/);
      if (x) jacketNums.add(x[1]);
    });

    // 番号が全て5以上なら DP、全て4以下なら SP (推測。判定不能なら null)
    const modeOf = (set) => {
      const a = [...set].map(Number);
      if (!a.length) return null;
      if (a.every((v) => v >= 5)) return 'DP';
      if (a.every((v) => v <= 4)) return 'SP';
      return null;
    };

    const hasCommon = [...jacketNums].some((v) => rowNums.has(v));
    if (jacketNums.size && !hasCommon) {
      stopped = true;
      const tableMode = modeOf(jacketNums);
      const scoreMode = modeOf(rowNums);
      show(
        '表示モード（SP/DP）が一致していません。\n' +
          (tableMode && scoreMode ? '難易度表: ' + tableMode + ' / スコアページ: ' + scoreMode + '\n' : '') +
          'スコアページ（3icecream.com/ddr/home/' + level + '）を難易度表と同じモードに切り替えてから、もう一度実行してください。',
        '#ff9800'
      );
      return;
    }

    // 画像の確認が終わるまで待つ (描画位置を確定させるため)
    await imagesPromise;

    // --- スコアを Map 化: キー "曲ID-難易度番号" ---
    const scores = new Map();
    rows.forEach((row) => {
      const m = row.id.match(/^(.*)-d(\d+)$/);
      if (!m) return;
      const scoreEl = row.querySelector('.td-score .sp-score');
      if (!scoreEl) return;
      const n = Number(scoreEl.textContent.replace(/[^\d]/g, ''));
      if (Number.isFinite(n) && n > 0) scores.set(m[1] + '-' + m[2], n);
    });

    // --- ジャケットごとにスコアとランクを描画 ---
    let count = 0;
    let scored = 0;

    document.querySelectorAll('.div-jacket[id^="div-jacket-"]').forEach((jacket) => {
      const m = jacket.id.match(/^div-jacket-(.*)-(\d+)$/);
      if (!m) return;

      const n = scores.get(m[1] + '-' + m[2]);
      const img = jacket.querySelector('img.img-jacket');
      if (!img) return;

      const jacketRect = jacket.getBoundingClientRect();
      const imgRect = img.getBoundingClientRect();
      if (!imgRect.width || !imgRect.height) return;

      jacket.style.position = 'relative';
      const color = n ? scoreColor(n) : '#fff';

      // スコアの黒帯 (画像の下端に重ねる)
      const band = document.createElement('span');
      band.className = 'my-ddr-score';
      band.textContent = n ? n.toLocaleString('en-US') : '';
      band.style.cssText = [
        'position:absolute',
        'left:' + (imgRect.left - jacketRect.left) + 'px',
        'top:' + (imgRect.bottom - jacketRect.top - BAND_HEIGHT) + 'px',
        'width:' + imgRect.width + 'px',
        'height:' + BAND_HEIGHT + 'px',
        'display:flex', 'align-items:center', 'justify-content:center',
        'box-sizing:border-box', 'padding:0',
        'background:linear-gradient(rgba(0,0,0,.82),rgba(0,0,0,.92))',
        'color:' + color + '!important',
        'font-family:Poppins,"Segoe UI",Arial,sans-serif',
        'font-variant-numeric:tabular-nums',
        'font-size:' + SCORE_FONT_SIZE + 'px',
        'font-weight:900', 'letter-spacing:-.5px', 'line-height:1',
        'white-space:nowrap',
        'text-shadow:0 0 8px ' + color + '99,1px 1px 0 #000,-1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000',
        'z-index:10', 'pointer-events:none',
      ].join(';');
      jacket.appendChild(band);

      if (n) {
        // 文字が帯からはみ出す場合は少しずつ縮める
        let fontSize = SCORE_FONT_SIZE;
        while (band.scrollWidth > band.clientWidth && fontSize > MIN_FONT_SIZE) {
          fontSize--;
          band.style.fontSize = fontSize + 'px';
        }

        // ランク文字 (ジャケット左上)
        const [, letter, sign] = rankOf(n);
        const rank = document.createElement('span');
        rank.className = 'my-ddr-score my-ddr-rank';
        rank.textContent = letter;
        rank.style.cssText = [
          'position:absolute',
          'left:' + (imgRect.left - jacketRect.left + 3) + 'px',
          'top:' + (imgRect.top - jacketRect.top + 1) + 'px',
          'display:inline-block', 'padding:0 2px 0 0',
          'font-family:Poppins,"Arial Black",Arial,sans-serif',
          'font-size:' + RANK_FONT_SIZE + 'px',
          'font-weight:900', 'font-style:italic', 'line-height:1.1',
          'letter-spacing:-1px', 'white-space:nowrap',
          'color:' + RANK_COLOR[letter] + '!important',
          'text-shadow:' + RANK_OUTLINE,
          'z-index:11', 'pointer-events:none',
        ].join(';');

        if (sign) {
          const signEl = document.createElement('span');
          signEl.textContent = sign;
          signEl.style.cssText =
            'font-size:.6em;position:relative;top:-.45em;margin-left:1px;letter-spacing:0';
          rank.appendChild(signEl);
        }
        jacket.appendChild(rank);
      }

      count++;
      if (n) scored++;
    });

    // --- ランク表示のトグルボタン ---
    const toggle = el(
      'button',
      [
        'position:fixed', 'bottom:16px', 'right:16px', 'z-index:2147483646',
        'padding:9px 16px', 'border:1px solid #4da3ff', 'border-radius:20px',
        'background:#1f2029', 'color:#fff', 'font:700 13px/1 sans-serif',
        'cursor:pointer', 'box-shadow:0 2px 10px rgba(0,0,0,.5)',
      ].join(';')
    );
    toggle.id = TOGGLE_ID;

    const applyRankVisibility = () => {
      document.querySelectorAll('.my-ddr-rank').forEach((e) => {
        e.style.display = showRank ? 'inline-block' : 'none';
      });
      toggle.textContent = 'ランク表示: ' + (showRank ? 'ON' : 'OFF');
    };

    toggle.onclick = () => {
      showRank = !showRank;
      try {
        localStorage.setItem(STORAGE_KEY, showRank ? '0' : '1');
      } catch (e) {
        /* 保存できなくても動作には影響しない */
      }
      applyRankVisibility();
    };

    document.body.appendChild(toggle);
    applyRankVisibility();

    // --- 完了表示 ---
    if (scored === 0) {
      show('スコアが1件も表示できませんでした。\nログイン状態とスコア登録を確認してください。', '#ff9800');
    } else {
      show(
        '完了しました\nスコア表示: ' + scored + '/' + count + '譜面\n未プレー: ' + (count - scored) + '譜面' +
          (fixed ? '\n画像修復: ' + fixed + '件' : ''),
        '#4caf50'
      );
      setTimeout(() => {
        if (box.isConnected) box.remove();
      }, 15000);
    }
  } catch (e) {
    stopped = true;
    show('エラーが発生しました\n' + e.message + '\n（詳細はコンソールを確認）', '#ff4d4f');
    console.error(e);
  } finally {
    if (frame) frame.remove();
  }
};
