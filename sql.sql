-- ================================================================
--  新增词书记录 — 插入 word_books 表
--  适配前端新增的 4 本词书: 中考/四级/六级/语感分级练习
-- ================================================================

USE vocabflow;

INSERT INTO `word_books` (`id`, `title`, `description`, `kind`, `total`) VALUES
  ('zhongkao',       '中考核心词汇',   '中考英语核心必背词汇',                         'word',     1672),
  ('cet4',           '四级核心词汇',   '大学英语四级核心必背词汇',                     'word',     3465),
  ('cet6',           '六级核心词汇',   '大学英语六级核心必背词汇',                     'word',     1761),
  ('language-sense', '英语语感分级练习', '英语语感分级练习 - 初中 / 高中 / 大学 中英对照', 'sentence', 600)
ON DUPLICATE KEY UPDATE
  `title` = VALUES(`title`),
  `description` = VALUES(`description`),
  `kind` = VALUES(`kind`),
  `total` = VALUES(`total`);
