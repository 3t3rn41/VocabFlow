-- ================================================================
--  VocabFlow 数据库建库建表脚本
--  MySQL 8.0+
--  字符集: utf8mb4 (支持 emoji 和多语言)
--  引擎:   InnoDB (支持事务和外键)
-- ================================================================

-- 创建数据库
CREATE DATABASE IF NOT EXISTS vocabflow
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

USE vocabflow;

-- ================================================================
--  1. 词书表 (word_books)
--  存储词书元数据：高考词汇、雅思词汇、雅思日常对话
-- ================================================================
DROP TABLE IF EXISTS `word_books`;
CREATE TABLE `word_books` (
  `id`          VARCHAR(64)   NOT NULL COMMENT '词书ID (gaokao / ielts / ielts-sentences)',
  `title`       VARCHAR(128)  NOT NULL COMMENT '词书标题',
  `description` TEXT          NULL     COMMENT '词书描述',
  `kind`        ENUM('word', 'sentence') NOT NULL DEFAULT 'word' COMMENT '词书类型',
  `total`       INT UNSIGNED  NOT NULL DEFAULT 0 COMMENT '词条/句子总数',
  `created_at`  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at`  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='词书元数据表';

-- ================================================================
--  2. 单词表 (words)
--  存储单词条目，来源: gaokao_words.json / IELTS_words.json
-- ================================================================
DROP TABLE IF EXISTS `words`;
CREATE TABLE `words` (
  `id`          BIGINT        NOT NULL AUTO_INCREMENT COMMENT '自增主键',
  `word_id`     VARCHAR(128)  NOT NULL COMMENT '业务ID (如 gaokao:abandon, ielts:abandon)',
  `book_id`     VARCHAR(64)   NOT NULL COMMENT '所属词书ID',
  `word`        VARCHAR(256)  NOT NULL COMMENT '英文单词',
  `phonetic`    VARCHAR(128)  NULL     COMMENT '音标 (如 /əˈbændən/)',
  `pos`         VARCHAR(32)   NULL     COMMENT '词性 (如 v., n., adj.)',
  `meaning_cn`  TEXT          NOT NULL COMMENT '中文释义',
  `example`     TEXT          NULL     COMMENT '英文例句',
  `example_cn`  TEXT          NULL     COMMENT '中文例句翻译',
  `created_at`  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_word_id` (`word_id`),
  KEY `idx_book_id` (`book_id`),
  KEY `idx_word` (`word`),
  CONSTRAINT `fk_words_book` FOREIGN KEY (`book_id`) REFERENCES `word_books`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='单词条目表';

-- ================================================================
--  3. 句子练习表 (sentence_bands / sentence_topics / sentence_dialogues)
--  存储雅思日常对话数据，来源: IELTS_sentences.json
--  三级层级: Band > Topic > Dialogue
-- ================================================================

-- 3.1 Band 表
DROP TABLE IF EXISTS `sentence_bands`;
CREATE TABLE `sentence_bands` (
  `id`          INT UNSIGNED  NOT NULL AUTO_INCREMENT COMMENT '自增主键',
  `band`        INT UNSIGNED  NOT NULL COMMENT 'Band 编号 (如 5, 6, 7)',
  `level`       VARCHAR(64)   NOT NULL COMMENT '等级描述 (如 "基础表达")',
  `created_at`  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_band` (`band`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='句子练习 Band 表';

-- 3.2 Topic 表
DROP TABLE IF EXISTS `sentence_topics`;
CREATE TABLE `sentence_topics` (
  `id`          INT UNSIGNED  NOT NULL AUTO_INCREMENT COMMENT '自增主键',
  `band_id`     INT UNSIGNED  NOT NULL COMMENT '所属 Band ID',
  `topic_idx`   INT UNSIGNED  NOT NULL COMMENT '在 Band 中的序号 (从0开始)',
  `topic`       VARCHAR(256)  NOT NULL COMMENT '话题名称 (如 "个人介绍 Self Introduction")',
  `created_at`  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_band_topic_idx` (`band_id`, `topic_idx`),
  KEY `idx_band_id` (`band_id`),
  CONSTRAINT `fk_topics_band` FOREIGN KEY (`band_id`) REFERENCES `sentence_bands`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='句子练习 Topic 表';

-- 3.3 Dialogue 表
DROP TABLE IF EXISTS `sentence_dialogues`;
CREATE TABLE `sentence_dialogues` (
  `id`            BIGINT        NOT NULL AUTO_INCREMENT COMMENT '自增主键',
  `topic_id`      INT UNSIGNED  NOT NULL COMMENT '所属 Topic ID',
  `dialogue_idx`  INT UNSIGNED  NOT NULL COMMENT '在 Topic 中的序号 (从0开始)',
  `cn`            TEXT          NOT NULL COMMENT '中文句子',
  `en`            TEXT          NOT NULL COMMENT '英文句子',
  `created_at`    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_topic_dialogue_idx` (`topic_id`, `dialogue_idx`),
  KEY `idx_topic_id` (`topic_id`),
  CONSTRAINT `fk_dialogues_topic` FOREIGN KEY (`topic_id`) REFERENCES `sentence_topics`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='句子练习 Dialogue 表';

-- ================================================================
--  4. SRS 卡片状态表 (srs_cards)
--  存储每个单词的 FSRS-4.5 间隔重复算法状态
-- ================================================================
DROP TABLE IF EXISTS `srs_cards`;
CREATE TABLE `srs_cards` (
  `id`            BIGINT        NOT NULL AUTO_INCREMENT COMMENT '自增主键',
  `word_id`       VARCHAR(128)  NOT NULL COMMENT '关联的单词业务ID',
  `book_id`       VARCHAR(64)   NOT NULL COMMENT '所属词书ID',
  `stability`     DOUBLE        NOT NULL DEFAULT 0 COMMENT 'FSRS 稳定性 (越大遗忘越慢)',
  `difficulty`    DOUBLE        NOT NULL DEFAULT 0 COMMENT 'FSRS 难度 (0-10, 越大越难)',
  `elapsed_days`  INT           NOT NULL DEFAULT 0 COMMENT '自上次复习经过的天数',
  `state`         TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '卡片状态: 0=NEW 1=LEARNING 2=REVIEW 3=RELEARNING',
  `due`           DATETIME      NOT NULL COMMENT '下次到期时间',
  `reps`          INT UNSIGNED  NOT NULL DEFAULT 0 COMMENT '总复习次数',
  `lapses`        INT UNSIGNED  NOT NULL DEFAULT 0 COMMENT '遗忘次数 (从REVIEW跌回RELEARNING)',
  `last_grade`    TINYINT UNSIGNED NULL     COMMENT '上次评分: 0=Again 1=Hard 2=Good 3=Easy',
  `updated_at`    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '最后更新时间',
  `created_at`    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_word_id` (`word_id`),
  KEY `idx_book_id` (`book_id`),
  KEY `idx_due` (`due`),
  KEY `idx_state` (`state`),
  CONSTRAINT `fk_cards_book` FOREIGN KEY (`book_id`) REFERENCES `word_books`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='SRS 卡片状态表 (FSRS-4.5)';

-- ================================================================
--  5. 复习日志表 (review_logs)
--  记录每次复习操作的日志，用于统计和分析
-- ================================================================
DROP TABLE IF EXISTS `review_logs`;
CREATE TABLE `review_logs` (
  `id`            BIGINT        NOT NULL AUTO_INCREMENT COMMENT '自增主键',
  `word_id`       VARCHAR(128)  NOT NULL COMMENT '关联的单词业务ID',
  `book_id`       VARCHAR(64)   NOT NULL COMMENT '所属词书ID',
  `reviewed_at`   DATETIME      NOT NULL COMMENT '复习时间',
  `grade`         TINYINT UNSIGNED NOT NULL COMMENT '评分: 0=Again 1=Hard 2=Good 3=Easy',
  `created_at`    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '记录创建时间',
  PRIMARY KEY (`id`),
  KEY `idx_word_id` (`word_id`),
  KEY `idx_book_id` (`book_id`),
  KEY `idx_reviewed_at` (`reviewed_at`),
  CONSTRAINT `fk_logs_book` FOREIGN KEY (`book_id`) REFERENCES `word_books`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='复习日志表';

-- ================================================================
--  6. 句子练习进度表 (sentence_progress)
--  记录用户在句子练习中完成的句子
-- ================================================================
DROP TABLE IF EXISTS `sentence_progress`;
CREATE TABLE `sentence_progress` (
  `id`            BIGINT        NOT NULL AUTO_INCREMENT COMMENT '自增主键',
  `band`          INT UNSIGNED  NOT NULL COMMENT 'Band 编号',
  `topic_idx`     INT UNSIGNED  NOT NULL COMMENT 'Topic 序号',
  `dialogue_idx`  INT UNSIGNED  NOT NULL COMMENT 'Dialogue 序号',
  `completed_at`  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '完成时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_band_topic_dialogue` (`band`, `topic_idx`, `dialogue_idx`),
  KEY `idx_band_topic` (`band`, `topic_idx`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='句子练习进度表';

-- ================================================================
--  7. 句子练习位置表 (sentence_position)
--  记录用户上次练习到的位置，刷新后可恢复
--  单行表，只存储当前用户的位置（如需多用户可加 user_id）
-- ================================================================
DROP TABLE IF EXISTS `sentence_position`;
CREATE TABLE `sentence_position` (
  `id`            BIGINT        NOT NULL AUTO_INCREMENT COMMENT '自增主键',
  `band`          INT UNSIGNED  NOT NULL COMMENT '当前 Band 编号',
  `topic_idx`     INT UNSIGNED  NOT NULL COMMENT '当前 Topic 序号',
  `dialogue_idx`  INT UNSIGNED  NOT NULL COMMENT '当前 Dialogue 序号',
  `updated_at`    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '最后更新时间',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='句子练习位置表 (单行)';

-- ================================================================
--  8. 用户设置表 (user_settings)
--  存储用户偏好设置（对应前端 settings store）
-- ================================================================
DROP TABLE IF EXISTS `user_settings`;
CREATE TABLE `user_settings` (
  `id`              BIGINT        NOT NULL AUTO_INCREMENT COMMENT '自增主键',
  `theme`           ENUM('light', 'dark', 'system') NOT NULL DEFAULT 'system' COMMENT '主题',
  `auto_play_audio` TINYINT(1)    NOT NULL DEFAULT 1 COMMENT '自动朗读发音',
  `srs_retention`   DECIMAL(3,2)  NOT NULL DEFAULT 0.90 COMMENT 'FSRS 目标保留率 (0.00-1.00)',
  `keyboard_layout` ENUM('3key', '4key') NOT NULL DEFAULT '3key' COMMENT '键盘评分布局',
  `daily_new_limit` INT UNSIGNED  NOT NULL DEFAULT 20 COMMENT '每日新词上限',
  `shuffle_words`   TINYINT(1)    NOT NULL DEFAULT 0 COMMENT '单词模式下是否打乱顺序',
  `tts_api_key`     VARCHAR(512)  NULL     COMMENT 'mimo TTS API Key (加密存储)',
  `updated_at`      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='用户设置表';

-- ================================================================
--  9. 活跃词书表 (active_book)
--  记录当前选中的词书（单行表）
-- ================================================================
DROP TABLE IF EXISTS `active_book`;
CREATE TABLE `active_book` (
  `id`          BIGINT        NOT NULL AUTO_INCREMENT COMMENT '自增主键',
  `book_id`     VARCHAR(64)   NOT NULL COMMENT '当前活跃词书ID',
  `updated_at`  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_active_book` FOREIGN KEY (`book_id`) REFERENCES `word_books`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='当前活跃词书表 (单行)';

-- ================================================================
--  初始化数据
-- ================================================================

-- 插入词书元数据
INSERT INTO `word_books` (`id`, `title`, `description`, `kind`, `total`) VALUES
  ('gaokao',          '高考核心词汇', '高考英语 3429 个核心必背词汇',                   'word',     3429),
  ('ielts',           '雅思核心词汇', '雅思核心词汇，含音标、词性、例句',                'word',     605),
  ('ielts-sentences', '雅思日常对话', '雅思日常对话练习，6 个 Band，710 句对话',         'sentence', 710);

-- 插入默认用户设置
INSERT INTO `user_settings` (`theme`, `auto_play_audio`, `srs_retention`, `keyboard_layout`, `daily_new_limit`, `shuffle_words`)
VALUES ('system', 1, 0.90, '3key', 20, 0);

-- ================================================================
--  视图：学习统计概览
-- ================================================================
CREATE OR REPLACE VIEW `v_learning_summary` AS
SELECT
  b.id    AS book_id,
  b.title AS book_title,
  b.total AS total_words,
  COUNT(DISTINCT c.word_id) AS learned_words,
  SUM(CASE WHEN c.due <= NOW() THEN 1 ELSE 0 END) AS due_words
FROM `word_books` b
LEFT JOIN `srs_cards` c ON c.book_id = b.id
WHERE b.kind = 'word'
GROUP BY b.id, b.title, b.total;

-- ================================================================
--  视图：今日复习统计
-- ================================================================
CREATE OR REPLACE VIEW `v_today_stats` AS
SELECT
  l.book_id,
  COUNT(*) AS today_count,
  SUM(CASE WHEN l.grade = 0 THEN 1 ELSE 0 END) AS again_count,
  SUM(CASE WHEN l.grade = 1 THEN 1 ELSE 0 END) AS hard_count,
  SUM(CASE WHEN l.grade = 2 THEN 1 ELSE 0 END) AS good_count,
  SUM(CASE WHEN l.grade = 3 THEN 1 ELSE 0 END) AS easy_count
FROM `review_logs` l
WHERE DATE(l.reviewed_at) = CURDATE()
GROUP BY l.book_id;

-- ================================================================
--  视图：连续学习天数
-- ================================================================
CREATE OR REPLACE VIEW `v_streak_days` AS
SELECT
  COUNT(DISTINCT DATE(reviewed_at)) AS streak_days
FROM `review_logs`
WHERE reviewed_at >= (
  SELECT COALESCE(
    (SELECT DATE(DATE_SUB(MIN(reviewed_at), INTERVAL 1 DAY))
     FROM `review_logs`
     WHERE DATE(reviewed_at) < CURDATE()
       AND DATE(reviewed_at) NOT IN (
         SELECT DISTINCT DATE(reviewed_at) FROM `review_logs`
       )
    ),
    DATE_SUB(CURDATE(), INTERVAL 365 DAY)
  )
);

-- ================================================================
--  存储过程：获取今日复习队列
-- ================================================================
DELIMITER //
DROP PROCEDURE IF EXISTS `sp_get_review_queue`//
CREATE PROCEDURE `sp_get_review_queue`(
  IN p_book_id VARCHAR(64),
  IN p_new_limit INT,
  IN p_review_limit INT
)
BEGIN
  -- 到期卡片
  SELECT
    w.word_id, w.word, w.phonetic, w.pos, w.meaning_cn,
    w.example, w.example_cn, w.book_id, 0 AS is_new
  FROM `words` w
  INNER JOIN `srs_cards` c ON c.word_id = w.word_id
  WHERE w.book_id = p_book_id
    AND c.due <= NOW()
  ORDER BY c.due ASC
  LIMIT p_review_limit;

  -- 新词（无卡片的单词）
  SELECT
    w.word_id, w.word, w.phonetic, w.pos, w.meaning_cn,
    w.example, w.example_cn, w.book_id, 1 AS is_new
  FROM `words` w
  LEFT JOIN `srs_cards` c ON c.word_id = w.word_id
  WHERE w.book_id = p_book_id
    AND c.word_id IS NULL
  LIMIT p_new_limit;
END//
DELIMITER ;

-- ================================================================
--  10. 句子熟知标记表 (sentence_mastery)
--  用户手动标记或系统自动判定的熟知句子
--  练习时自动跳过熟知句子，除非用户选择"复习全部"
-- ================================================================
DROP TABLE IF EXISTS `sentence_mastery`;
CREATE TABLE `sentence_mastery` (
  `id`            BIGINT        NOT NULL AUTO_INCREMENT COMMENT '自增主键',
  `band`          INT UNSIGNED  NOT NULL COMMENT 'Band 编号',
  `topic_idx`     INT UNSIGNED  NOT NULL COMMENT 'Topic 序号',
  `dialogue_idx`  INT UNSIGNED  NOT NULL COMMENT 'Dialogue 序号',
  `source`        ENUM('manual', 'auto') NOT NULL DEFAULT 'manual' COMMENT '标记来源: manual=用户手动, auto=系统自动判定',
  `proficiency`   TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '熟练度评分 0-100 (越高越熟练)',
  `pause_ms`      INT UNSIGNED  NOT NULL DEFAULT 0 COMMENT '总停顿时间(毫秒)',
  `tab_count`     INT UNSIGNED  NOT NULL DEFAULT 0 COMMENT 'Tab提示次数',
  `typo_count`    INT UNSIGNED  NOT NULL DEFAULT 0 COMMENT '拼错次数',
  `created_at`    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at`    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_band_topic_dialogue` (`band`, `topic_idx`, `dialogue_idx`),
  KEY `idx_band_topic` (`band`, `topic_idx`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='句子熟知标记表';

-- ================================================================
--  11. 句子练习历史记录表 (sentence_practice_log)
--  每次句子练习完成时记录一条，用于追踪熟练度变化趋势
-- ================================================================
DROP TABLE IF EXISTS `sentence_practice_log`;
CREATE TABLE `sentence_practice_log` (
  `id`            BIGINT        NOT NULL AUTO_INCREMENT COMMENT '自增主键',
  `band`          INT UNSIGNED  NOT NULL COMMENT 'Band 编号',
  `topic_idx`     INT UNSIGNED  NOT NULL COMMENT 'Topic 序号',
  `dialogue_idx`  INT UNSIGNED  NOT NULL COMMENT 'Dialogue 序号',
  `proficiency`   TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '本次练习熟练度 0-100',
  `pause_ms`      INT UNSIGNED  NOT NULL DEFAULT 0 COMMENT '总停顿时间(毫秒)',
  `tab_count`     INT UNSIGNED  NOT NULL DEFAULT 0 COMMENT 'Tab提示次数',
  `typo_count`    INT UNSIGNED  NOT NULL DEFAULT 0 COMMENT '拼错次数',
  `practiced_at`  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '练习时间',
  PRIMARY KEY (`id`),
  KEY `idx_band_topic_dialogue` (`band`, `topic_idx`, `dialogue_idx`),
  KEY `idx_practiced_at` (`practiced_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='句子练习历史记录表';

-- ================================================================
--  完成提示
-- ================================================================
SELECT 'vocabflow 数据库创建完成！' AS message;
