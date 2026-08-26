'use strict';

/**
 * 分頁切換，以及把路徑編輯器掛進來。
 *
 * <h3>編輯器為什麼是另外一頁</h3>
 * 它用的是 syncdrive_t3 前端的 <code>MapAreaCanvas</code>——地圖編輯器的圖台本體，
 * 儀表板與虛擬圍籬也是重用同一支。這樣圖台上看到的東西才會和地圖編輯器一模一樣，
 * 而不是用原生 JS 照著描一個像的：描出來的必然對不齊，而且地圖一改版就走鐘。
 *
 * 那份是 React ＋ Tailwind 建置出來的，塞不進這一頁的原生 JS，所以放在
 * <code>/paths/</code> 由 iframe 掛進來。同源，兩邊打的是同一組 API。
 *
 * iframe 到<strong>第一次切到這一頁才載入</strong>：整份圖資加圖台不小，開頁就抓
 * 會拖慢真正常用的「模擬控制」。這與先前那個 bug 不同——那次是失敗之後永遠不重試，
 * 現在每次切過來只要還沒載入就會再試一次，而且編輯器自己也有「重新載入圖資」。
 */

(function initTabs() {
  const frame = document.getElementById('routeFrame');
  const panels = document.querySelectorAll('[data-panel]');
  const tabs = document.querySelectorAll('.tab');

  function showTab(name) {
    for (const tab of tabs) tab.classList.toggle('active', tab.dataset.tab === name);
    for (const panel of panels) panel.hidden = panel.dataset.panel !== name;
    if (name === 'routes' && frame && !frame.getAttribute('src')) {
      frame.setAttribute('src', '/paths/');
    }
  }

  for (const tab of tabs) {
    tab.addEventListener('click', () => showTab(tab.dataset.tab));
  }
})();
