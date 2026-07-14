-- ================================================================
--  VocabFlow 用户系统迁移脚本
--  用于在已有数据库上添加多用户支持
--  执行前请备份数据库！
-- ================================================================

USE vocabflow;

-- ================================================================
--  1. 创建 users 表
-- ================================================================
CREATE TABLE IF NOT EXISTS `users` (
  `id`            BIGINT        NOT NULL AUTO_INCREMENT COMMENT '自增主键',
  `username`      VARCHAR(64)   NOT NULL COMMENT '用户名 (唯一)',
  `password_hash` VARCHAR(255)  NOT NULL COMMENT 'bcrypt 加密的密码哈希',
  `created_at`    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '注册时间',
  `updated_at`    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='用户表';

-- 创建一个默认用户 (id=1) 用于迁移现有数据
INSERT INTO `users` (`id`, `username`, `password_hash`)
VALUES (1, 'admin', '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy')
ON DUPLICATE KEY UPDATE `id` = `id`;

-- ================================================================
--  2. srs_cards: 添加 user_id 列
-- ================================================================
ALTER TABLE `srs_cards` ADD COLUMN `user_id` BIGINT NOT NULL DEFAULT 1 COMMENT '所属用户ID' AFTER `id`;

-- 删除旧的唯一索引并创建新的复合唯一索引
ALTER TABLE `srs_cards` DROP INDEX `uk_word_id`;
ALTER TABLE `srs_cards` ADD UNIQUE KEY `uk_user_word_id` (`user_id`, `word_id`);

-- 添加新的索引
ALTER TABLE `srs_cards` ADD KEY `idx_user_book_id` (`user_id`, `book_id`);
ALTER TABLE `srs_cards` ADD KEY `idx_user_due` (`user_id`, `due`);

-- 添加外键
ALTER TABLE `srs_cards` ADD CONSTRAINT `fk_cards_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE;

-- 删除旧的索引 (如果存在)
ALTER TABLE `srs_cards` DROP INDEX `idx_book_id`;
ALTER TABLE `srs_cards` DROP INDEX `idx_due`;

-- ================================================================
--  3. review_logs: 添加 user_id 列
-- ================================================================
ALTER TABLE `review_logs` ADD COLUMN `user_id` BIGINT NOT NULL DEFAULT 1 COMMENT '所属用户ID' AFTER `id`;

ALTER TABLE `review_logs` ADD KEY `idx_user_word_id` (`user_id`, `word_id`);
ALTER TABLE `review_logs` ADD KEY `idx_user_book_id` (`user_id`, `book_id`);
ALTER TABLE `review_logs` ADD KEY `idx_user_reviewed_at` (`user_id`, `reviewed_at`);

ALTER TABLE `review_logs` ADD CONSTRAINT `fk_logs_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE;

-- 删除旧索引
ALTER TABLE `review_logs` DROP INDEX `idx_word_id`;
ALTER TABLE `review_logs` DROP INDEX `idx_book_id`;
ALTER TABLE `review_logs` DROP INDEX `idx_reviewed_at`;

-- ================================================================
--  4. sentence_progress: 添加 user_id 列
-- ================================================================
ALTER TABLE `sentence_progress` ADD COLUMN `user_id` BIGINT NOT NULL DEFAULT 1 COMMENT '所属用户ID' AFTER `id`;

ALTER TABLE `sentence_progress` DROP INDEX `uk_band_topic_dialogue`;
ALTER TABLE `sentence_progress` ADD UNIQUE KEY `uk_user_band_topic_dialogue` (`user_id`, `band`, `topic_idx`, `dialogue_idx`);

ALTER TABLE `sentence_progress` DROP INDEX `idx_band_topic`;
ALTER TABLE `sentence_progress` ADD KEY `idx_user_band_topic` (`user_id`, `band`, `topic_idx`);

ALTER TABLE `sentence_progress` ADD CONSTRAINT `fk_progress_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE;

-- ================================================================
--  5. sentence_position: 添加 user_id 列
-- ================================================================
ALTER TABLE `sentence_position` ADD COLUMN `user_id` BIGINT NOT NULL DEFAULT 1 COMMENT '所属用户ID' AFTER `id`;

ALTER TABLE `sentence_position` ADD UNIQUE KEY `uk_user_id` (`user_id`);

ALTER TABLE `sentence_position` ADD CONSTRAINT `fk_position_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE;

-- ================================================================
--  6. user_settings: 添加 user_id 列
-- ================================================================
ALTER TABLE `user_settings` ADD COLUMN `user_id` BIGINT NOT NULL DEFAULT 1 COMMENT '所属用户ID' AFTER `id`;

ALTER TABLE `user_settings` ADD UNIQUE KEY `uk_user_id` (`user_id`);

ALTER TABLE `user_settings` ADD CONSTRAINT `fk_settings_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE;

-- ================================================================
--  7. active_book: 添加 user_id 列
-- ================================================================
ALTER TABLE `active_book` ADD COLUMN `user_id` BIGINT NOT NULL DEFAULT 1 COMMENT '所属用户ID' AFTER `id`;

ALTER TABLE `active_book` ADD UNIQUE KEY `uk_user_id` (`user_id`);

ALTER TABLE `active_book` ADD CONSTRAINT `fk_active_book_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE;

-- ================================================================
--  8. sentence_mastery: 添加 user_id 列
-- ================================================================
ALTER TABLE `sentence_mastery` ADD COLUMN `user_id` BIGINT NOT NULL DEFAULT 1 COMMENT '所属用户ID' AFTER `id`;

ALTER TABLE `sentence_mastery` DROP INDEX `uk_band_topic_dialogue`;
ALTER TABLE `sentence_mastery` ADD UNIQUE KEY `uk_user_band_topic_dialogue` (`user_id`, `band`, `topic_idx`, `dialogue_idx`);

ALTER TABLE `sentence_mastery` DROP INDEX `idx_band_topic`;
ALTER TABLE `sentence_mastery` ADD KEY `idx_user_band_topic` (`user_id`, `band`, `topic_idx`);

ALTER TABLE `sentence_mastery` ADD CONSTRAINT `fk_mastery_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE;

-- ================================================================
--  9. sentence_practice_log: 添加 user_id 列
-- ================================================================
ALTER TABLE `sentence_practice_log` ADD COLUMN `user_id` BIGINT NOT NULL DEFAULT 1 COMMENT '所属用户ID' AFTER `id`;

ALTER TABLE `sentence_practice_log` ADD KEY `idx_user_band_topic_dialogue` (`user_id`, `band`, `topic_idx`, `dialogue_idx`);
ALTER TABLE `sentence_practice_log` ADD KEY `idx_user_practiced_at` (`user_id`, `practiced_at`);

ALTER TABLE `sentence_practice_log` ADD CONSTRAINT `fk_practice_log_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE;

-- 删除旧索引
ALTER TABLE `sentence_practice_log` DROP INDEX `idx_band_topic_dialogue`;
ALTER TABLE `sentence_practice_log` DROP INDEX `idx_practiced_at`;

-- ================================================================
--  迁移完成
-- ================================================================
SELECT '用户系统迁移完成！默认用户: admin / admin123' AS message;
