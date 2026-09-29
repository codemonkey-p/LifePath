// Small shared helpers for the memory games. Games are gentle by design: no timers,
// no losing, wrong taps just fade out and the person can try again.
window.GameKit = (function () {
  const ITEMS = ['🍎','🍌','🐶','🐱','🌼','🚗','☂️','🏡','⚽','🎵','🍞','☕','⭐','🐦','🌞','🎈','🍓','🐟','👒','🔑'];
  const PRAISE = ['Well done!', 'Great job!', 'That\'s right!', 'Lovely!', 'Wonderful!', 'Very good!'];
  const RETRY = ['Not quite - try again', 'Have another go', 'Almost - try another one'];

  function shuffle(list) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function sample(list, n) { return shuffle(list).slice(0, n); }
  function pick(list) { return list[Math.floor(Math.random() * list.length)]; }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function button(label, className, onClick) {
    const b = el('button', className, label);
    b.addEventListener('click', onClick);
    return b;
  }

  // End-of-game screen. Always encouraging, whatever the score.
  function showResult(container, score, total, playAgain) {
    container.replaceChildren();
    const box = el('div', 'game-result');
    box.appendChild(el('div', 'game-result-emoji', '🌟'));
    box.appendChild(el('div', 'game-result-title', 'All done - well played!'));
    box.appendChild(el('div', 'game-result-score', `You got ${score} of ${total} on the first try.`));
    box.appendChild(button('Play again', 'btn secondary', playAgain));
    container.appendChild(box);
  }

  return { ITEMS, PRAISE, RETRY, shuffle, sample, pick, el, button, showResult };
})();
