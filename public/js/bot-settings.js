// Canonical IDs mirror shared/bots.json; all tuning numbers live in that JSON.
export const BOT_DIFFICULTIES = ['mixed', 'recruit', 'regular', 'veteran', 'elite'];
export function cleanBotSettings(config = {}) {
  const n = Number(config.botCount);
  return {
    botCount: Number.isFinite(n) ? Math.max(0, Math.min(16, Math.trunc(n))) : 0,
    botDifficulty: BOT_DIFFICULTIES.includes(config.botDifficulty) ? config.botDifficulty : 'mixed',
  };
}

export const BOT_DIFFICULTY_HINTS = {
  mixed: '混合编队：多数新兵与普通士兵，少量老兵。',
  recruit: '反应 550–1000 毫秒；瞄准较松，决策更容易犯错。',
  regular: '反应 300–600 毫秒；均衡跟枪、掩体与战术选择。',
  veteran: '反应 150–300 毫秒；更可靠的侧翼配合与受压找掩体。',
  elite: '反应 120–240 毫秒；更稳定的协同与跟枪，仍有失误。',
};
