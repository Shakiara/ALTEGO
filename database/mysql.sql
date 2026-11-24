-- ALTEGO necesita inicializar una base MySQL nueva sin sobrescribir datos existentes.
-- Este script crea el esquema completo, sus restricciones y la cuenta y productos académicos autorizados.
CREATE DATABASE `tienda_avatares_2053` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `tienda_avatares_2053`;
SET @altego_fk_checks=@@FOREIGN_KEY_CHECKS;
SET FOREIGN_KEY_CHECKS=0;
CREATE TABLE `account_activity` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `public_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `user_id` int unsigned NOT NULL,
  `event_type` varchar(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `category` enum('content','interactions','changes') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `occurred_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `resource_type` enum('account','product','user') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `resource_id` varchar(10) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `reference_label` varchar(160) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `metadata` json NOT NULL,
  `search_text` varchar(700) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `event_key` varchar(160) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `activity_public_id` (`public_id`),
  UNIQUE KEY `activity_operation` (`user_id`,`event_key`),
  KEY `activity_chronology` (`user_id`,`occurred_at`,`id`),
  KEY `activity_category` (`user_id`,`category`,`occurred_at`,`id`),
  CONSTRAINT `fk_activity_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `chk_activity_metadata` CHECK (((json_type(`metadata`) = _utf8mb4'OBJECT') and (length(cast(`metadata` as char charset utf8mb4)) <= 4096)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `account_sanctions` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int unsigned NOT NULL,
  `issued_by` int unsigned DEFAULT NULL,
  `kind` enum('warning','suspension') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `reason` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `explanation` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `issued_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `expires_at` datetime(6) DEFAULT NULL,
  `lifted_at` datetime(6) DEFAULT NULL,
  `lifted_by` int unsigned DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `sanction_history` (`user_id`,`id`),
  KEY `issued_by` (`issued_by`),
  KEY `lifted_by` (`lifted_by`),
  CONSTRAINT `account_sanctions_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `account_sanctions_ibfk_2` FOREIGN KEY (`issued_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `account_sanctions_ibfk_3` FOREIGN KEY (`lifted_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `account_settings` (
  `user_id` int unsigned NOT NULL,
  `followers_visibility` enum('public','private') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'public',
  `following_visibility` enum('public','private') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'public',
  `username_changed_at` datetime(6) DEFAULT NULL,
  `revision` int unsigned NOT NULL DEFAULT '1',
  `display_name_changed_at` datetime(6) DEFAULT NULL,
  PRIMARY KEY (`user_id`),
  CONSTRAINT `account_settings_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `activity_outbox` (
  `id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `user_id` int unsigned NOT NULL,
  `review_id` char(24) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `request_key` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `request_checksum` char(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `event_payload` json NOT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `recorded_at` datetime(6) DEFAULT NULL,
  `last_checked_at` datetime(6) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `activity_review` (`review_id`),
  UNIQUE KEY `activity_request` (`user_id`,`request_key`),
  KEY `activity_recovery` (`user_id`,`recorded_at`,`last_checked_at`,`created_at`),
  CONSTRAINT `fk_activity_outbox_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `chk_activity_outbox_metadata` CHECK (((json_type(`event_payload`) = _utf8mb4'OBJECT') and (length(cast(`event_payload` as char charset utf8mb4)) <= 4096)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `administrative_audit` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `actor_id` int unsigned DEFAULT NULL,
  `category` enum('moderation','sanctions','roles','security','verification','products') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `action` varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `entity_type` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `entity_id` varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `reason` varchar(48) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `changes` json DEFAULT NULL,
  `result` enum('success','denied','failed') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'success',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `audit_category` (`category`,`id`),
  KEY `audit_retention` (`created_at`),
  KEY `audit_entity` (`entity_type`,`entity_id`),
  KEY `actor_id` (`actor_id`),
  CONSTRAINT `administrative_audit_ibfk_1` FOREIGN KEY (`actor_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `asset_file_links` (
  `asset_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `representation` enum('original','preview') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `file_id` bigint unsigned NOT NULL,
  `product_id` int unsigned NOT NULL,
  PRIMARY KEY (`product_id`,`asset_id`,`representation`),
  KEY `file_id` (`file_id`),
  KEY `asset_lookup` (`asset_id`,`representation`),
  CONSTRAINT `asset_file_links_ibfk_1` FOREIGN KEY (`asset_id`) REFERENCES `assets` (`id`),
  CONSTRAINT `asset_file_links_ibfk_2` FOREIGN KEY (`file_id`) REFERENCES `product_files` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `assets` (
  `id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `owner_id` int unsigned NOT NULL,
  `kind` enum('glb','png') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `sha256` char(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `byte_size` int NOT NULL,
  `metadata` json NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `storage_layout` enum('legacy','temporary','product') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'legacy',
  `storage_state` enum('pending','ready','failed','abandoned') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'ready',
  `product_id` int unsigned DEFAULT NULL,
  `abandoned_at` datetime(6) DEFAULT NULL,
  `abandonment_reason` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `abandoned_artifacts` json DEFAULT NULL,
  `retention_protected` tinyint(1) NOT NULL DEFAULT '0',
  `last_activity_at` datetime(6) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `owner_id` (`owner_id`),
  KEY `fk_asset_product` (`product_id`),
  CONSTRAINT `assets_ibfk_1` FOREIGN KEY (`owner_id`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_asset_product` FOREIGN KEY (`product_id`) REFERENCES `productos` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `categorias` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `nombre` varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `descripcion` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `icon_svg` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `display_order` int unsigned NOT NULL DEFAULT '0',
  `active` tinyint(1) NOT NULL DEFAULT '1',
  `filter_visible` tinyint(1) NOT NULL DEFAULT '1',
  `revision` int unsigned NOT NULL DEFAULT '1',
  PRIMARY KEY (`id`),
  UNIQUE KEY `nombre` (`nombre`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `community_case_keys` (
  `content_type` enum('post','comment','reply','product','review') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `target_id` int unsigned NOT NULL,
  `case_id` int unsigned NOT NULL,
  PRIMARY KEY (`content_type`,`target_id`),
  KEY `case_id` (`case_id`),
  CONSTRAINT `community_case_keys_ibfk_1` FOREIGN KEY (`case_id`) REFERENCES `conversation_moderation_cases` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `conversation_comment_reactions` (
  `target_id` int unsigned NOT NULL,
  `user_id` int unsigned NOT NULL,
  `reaction` enum('like','love','haha','wow','sad','angry','adore','fire') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  PRIMARY KEY (`target_id`,`user_id`),
  KEY `user_reactions` (`user_id`,`reaction`),
  CONSTRAINT `conversation_comment_reactions_ibfk_1` FOREIGN KEY (`target_id`) REFERENCES `conversation_comments` (`id`) ON DELETE CASCADE,
  CONSTRAINT `conversation_comment_reactions_ibfk_2` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `conversation_comments` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `public_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `post_id` int unsigned NOT NULL,
  `author_id` int unsigned NOT NULL,
  `root_id` int unsigned DEFAULT NULL,
  `reply_to_id` int unsigned DEFAULT NULL,
  `body` varchar(1000) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `revision` int unsigned NOT NULL DEFAULT '1',
  `request_key` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `request_hash` char(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `hidden_at` datetime(6) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `public_id` (`public_id`),
  UNIQUE KEY `comment_request` (`author_id`,`request_key`),
  KEY `comment_order` (`post_id`,`root_id`,`id`),
  KEY `root_id` (`root_id`),
  KEY `reply_to_id` (`reply_to_id`),
  CONSTRAINT `conversation_comments_ibfk_1` FOREIGN KEY (`post_id`) REFERENCES `conversation_posts` (`id`) ON DELETE CASCADE,
  CONSTRAINT `conversation_comments_ibfk_2` FOREIGN KEY (`author_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `conversation_comments_ibfk_3` FOREIGN KEY (`root_id`) REFERENCES `conversation_comments` (`id`) ON DELETE CASCADE,
  CONSTRAINT `conversation_comments_ibfk_4` FOREIGN KEY (`reply_to_id`) REFERENCES `conversation_comments` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `conversation_hidden_posts` (
  `post_id` int unsigned NOT NULL,
  PRIMARY KEY (`post_id`),
  CONSTRAINT `conversation_hidden_posts_ibfk_1` FOREIGN KEY (`post_id`) REFERENCES `conversation_posts` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `conversation_mentions` (
  `comment_id` int unsigned NOT NULL,
  `start_offset` smallint unsigned NOT NULL,
  `end_offset` smallint unsigned NOT NULL,
  `recipient_id` int unsigned NOT NULL,
  PRIMARY KEY (`comment_id`,`start_offset`),
  KEY `recipient_id` (`recipient_id`),
  CONSTRAINT `conversation_mentions_ibfk_1` FOREIGN KEY (`comment_id`) REFERENCES `conversation_comments` (`id`) ON DELETE CASCADE,
  CONSTRAINT `conversation_mentions_ibfk_2` FOREIGN KEY (`recipient_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `conversation_moderation_cases` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `public_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `post_id` int unsigned DEFAULT NULL,
  `target_id` int unsigned NOT NULL,
  `target_public_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `content_type` enum('post','comment','reply','product','review') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `author_id` int unsigned DEFAULT NULL,
  `status` enum('pending','restored','removed') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `active_target` int unsigned GENERATED ALWAYS AS (if((`status` = _utf8mb4'pending'),`target_id`,NULL)) VIRTUAL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `resolved_at` datetime(6) DEFAULT NULL,
  `moderator_id` int unsigned DEFAULT NULL,
  `assigned_to` int unsigned DEFAULT NULL,
  `decision_reason` varchar(48) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `public_id` (`public_id`),
  UNIQUE KEY `moderation_pending_target` (`content_type`,`active_target`),
  KEY `moderation_queue` (`status`,`id`),
  KEY `moderation_post` (`post_id`,`status`),
  KEY `author_id` (`author_id`),
  KEY `moderator_id` (`moderator_id`),
  CONSTRAINT `conversation_moderation_cases_ibfk_1` FOREIGN KEY (`post_id`) REFERENCES `conversation_posts` (`id`) ON DELETE SET NULL,
  CONSTRAINT `conversation_moderation_cases_ibfk_2` FOREIGN KEY (`author_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `conversation_moderation_cases_ibfk_3` FOREIGN KEY (`moderator_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `conversation_poll_options` (
  `post_id` int unsigned NOT NULL,
  `position` tinyint unsigned NOT NULL,
  `label` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  PRIMARY KEY (`post_id`,`position`),
  CONSTRAINT `conversation_poll_options_ibfk_1` FOREIGN KEY (`post_id`) REFERENCES `conversation_polls` (`post_id`) ON DELETE CASCADE,
  CONSTRAINT `chk_poll_position` CHECK ((`position` between 1 and 6))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `conversation_poll_votes` (
  `post_id` int unsigned NOT NULL,
  `user_id` int unsigned NOT NULL,
  `position` tinyint unsigned NOT NULL,
  PRIMARY KEY (`post_id`,`user_id`),
  KEY `post_id` (`post_id`,`position`),
  KEY `user_id` (`user_id`),
  CONSTRAINT `conversation_poll_votes_ibfk_1` FOREIGN KEY (`post_id`, `position`) REFERENCES `conversation_poll_options` (`post_id`, `position`) ON DELETE CASCADE,
  CONSTRAINT `conversation_poll_votes_ibfk_2` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `conversation_polls` (
  `post_id` int unsigned NOT NULL,
  `ends_at` datetime(6) NOT NULL,
  `closed_at` datetime(6) DEFAULT NULL,
  `voting_started_at` datetime(6) DEFAULT NULL,
  PRIMARY KEY (`post_id`),
  CONSTRAINT `conversation_polls_ibfk_1` FOREIGN KEY (`post_id`) REFERENCES `conversation_posts` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `conversation_post_images` (
  `post_id` int unsigned NOT NULL,
  `position` tinyint unsigned NOT NULL,
  `image_bytes` mediumblob NOT NULL,
  `storage_path` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `storage_sha256` char(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`post_id`,`position`),
  CONSTRAINT `fk_conversation_image` FOREIGN KEY (`post_id`) REFERENCES `conversation_posts` (`id`) ON DELETE CASCADE,
  CONSTRAINT `chk_conversation_image_position` CHECK ((`position` < 8)),
  CONSTRAINT `chk_conversation_image_size` CHECK (((length(`image_bytes`) between 1 and 2097152) or ((length(`image_bytes`) = 0) and (`storage_path` is not null) and regexp_like(`storage_sha256`,_utf8mb4'^[a-f0-9]{64}$'))))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `conversation_post_reactions` (
  `target_id` int unsigned NOT NULL,
  `user_id` int unsigned NOT NULL,
  `reaction` enum('like','love','haha','wow','sad','angry','adore','fire') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  PRIMARY KEY (`target_id`,`user_id`),
  KEY `user_reactions` (`user_id`,`reaction`),
  CONSTRAINT `conversation_post_reactions_ibfk_1` FOREIGN KEY (`target_id`) REFERENCES `conversation_posts` (`id`) ON DELETE CASCADE,
  CONSTRAINT `conversation_post_reactions_ibfk_2` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `conversation_posts` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `public_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `author_id` int unsigned NOT NULL,
  `request_key` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `request_hash` char(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `title` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` varchar(2000) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `image_count` tinyint unsigned NOT NULL DEFAULT '0',
  `pinned` tinyint(1) NOT NULL DEFAULT '0',
  `pinned_author_id` int unsigned GENERATED ALWAYS AS (if(`pinned`,`author_id`,NULL)) VIRTUAL,
  `revision` int unsigned NOT NULL DEFAULT '1',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `edited_at` datetime(6) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `conversation_public_id` (`public_id`),
  UNIQUE KEY `conversation_request` (`author_id`,`request_key`),
  UNIQUE KEY `conversation_pin` (`pinned_author_id`),
  KEY `conversation_feed` (`author_id`,`pinned`,`created_at`,`id`),
  CONSTRAINT `fk_conversation_author` FOREIGN KEY (`author_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `chk_conversation_images` CHECK ((`image_count` <= 8))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `conversation_rank` (
  `post_id` int unsigned NOT NULL,
  `revision` bigint unsigned NOT NULL DEFAULT '1',
  PRIMARY KEY (`post_id`),
  CONSTRAINT `conversation_rank_ibfk_1` FOREIGN KEY (`post_id`) REFERENCES `conversation_posts` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `conversation_reports` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `public_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `reporter_id` int unsigned NOT NULL,
  `post_id` int unsigned DEFAULT NULL,
  `content_type` enum('post','comment','reply','product','review') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `target_id` int unsigned NOT NULL,
  `reason` enum('harassment','hate_speech','spam','inappropriate','violence','other') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` enum('active','resolved') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  `active_reporter` int unsigned GENERATED ALWAYS AS (if((`status` = _utf8mb4'active'),`reporter_id`,NULL)) VIRTUAL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `case_id` int unsigned DEFAULT NULL,
  `explanation` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `public_id` (`public_id`),
  UNIQUE KEY `report_active_user` (`content_type`,`target_id`,`active_reporter`),
  KEY `report_target` (`content_type`,`target_id`,`status`),
  KEY `report_post` (`post_id`,`status`),
  KEY `reporter_id` (`reporter_id`),
  KEY `case_id` (`case_id`),
  CONSTRAINT `conversation_reports_ibfk_1` FOREIGN KEY (`reporter_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `conversation_reports_ibfk_2` FOREIGN KEY (`post_id`) REFERENCES `conversation_posts` (`id`) ON DELETE SET NULL,
  CONSTRAINT `conversation_reports_ibfk_3` FOREIGN KEY (`case_id`) REFERENCES `conversation_moderation_cases` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `creator_follows` (
  `follower_id` int unsigned NOT NULL,
  `creator_id` int unsigned NOT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`follower_id`,`creator_id`),
  KEY `creator_followers` (`creator_id`,`follower_id`),
  CONSTRAINT `creator_follows_ibfk_1` FOREIGN KEY (`follower_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `creator_follows_ibfk_2` FOREIGN KEY (`creator_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `distinct_creator_follow` CHECK ((`follower_id` <> `creator_id`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `creator_verification_applications` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int unsigned NOT NULL,
  `status` enum('pending','approved','rejected','revoked') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `pending_user` int unsigned GENERATED ALWAYS AS (if((`status` = _utf8mb4'pending'),`user_id`,NULL)) VIRTUAL,
  `verified_user` int unsigned GENERATED ALWAYS AS (if((`status` = _utf8mb4'approved'),`user_id`,NULL)) VIRTUAL,
  `submitted_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `decided_at` datetime(6) DEFAULT NULL,
  `decided_by` int unsigned DEFAULT NULL,
  `rejection_reason` varchar(48) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `revoked_at` datetime(6) DEFAULT NULL,
  `revoked_by` int unsigned DEFAULT NULL,
  `revocation_reason` varchar(48) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `retry_at` datetime(6) DEFAULT NULL,
  `approval_reason` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `approval_exception` json DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `verification_pending` (`pending_user`),
  UNIQUE KEY `verification_active` (`verified_user`),
  KEY `verification_user_history` (`user_id`,`id`),
  KEY `verification_queue` (`status`,`id`),
  KEY `decided_by` (`decided_by`),
  KEY `revoked_by` (`revoked_by`),
  CONSTRAINT `creator_verification_applications_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `creator_verification_applications_ibfk_2` FOREIGN KEY (`decided_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `creator_verification_applications_ibfk_3` FOREIGN KEY (`revoked_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `creator_verification_periods` (
  `user_id` int unsigned NOT NULL,
  `sequence_number` int unsigned NOT NULL DEFAULT '0',
  `can_apply` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`user_id`),
  CONSTRAINT `creator_verification_periods_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `legacy_retirement_operations` (
  `id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `batch_hash` char(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `relative_path` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `descriptor` json NOT NULL,
  `state` enum('planned','quarantined','restored','purge_planned','purged') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `last_error` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` timestamp(6) NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` timestamp(6) NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `quarantined_at` datetime(6) DEFAULT NULL,
  `purge_intent_at` datetime(6) DEFAULT NULL,
  `purged_at` datetime(6) DEFAULT NULL,
  `purge_metadata` json DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `batch_hash` (`batch_hash`,`relative_path`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `moderation_removals` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `entity_type` enum('product','post','comment','reply','review') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `entity_id` int unsigned NOT NULL,
  `owner_id` int unsigned DEFAULT NULL,
  `label` varchar(160) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `reason` varchar(48) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `explanation` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `removed_by` int unsigned DEFAULT NULL,
  `removed_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `restored_by` int unsigned DEFAULT NULL,
  `restored_at` datetime(6) DEFAULT NULL,
  `active_entity` varchar(70) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci GENERATED ALWAYS AS (if((`restored_at` is null),concat(`entity_type`,_utf8mb4':',`entity_id`),NULL)) VIRTUAL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `active_removal` (`active_entity`),
  KEY `removal_history` (`entity_type`,`entity_id`,`id`),
  KEY `owner_id` (`owner_id`),
  KEY `removed_by` (`removed_by`),
  KEY `restored_by` (`restored_by`),
  CONSTRAINT `moderation_removals_ibfk_1` FOREIGN KEY (`owner_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `moderation_removals_ibfk_2` FOREIGN KEY (`removed_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `moderation_removals_ibfk_3` FOREIGN KEY (`restored_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `product_files` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `product_id` int unsigned NOT NULL,
  `creator_id` int unsigned NOT NULL,
  `kind` enum('glb','png') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `sha256` char(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `byte_size` int unsigned NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `storage_version` int unsigned DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `product_id` (`product_id`,`kind`,`sha256`),
  KEY `creator_id` (`creator_id`),
  CONSTRAINT `product_files_ibfk_1` FOREIGN KEY (`product_id`) REFERENCES `productos` (`id`),
  CONSTRAINT `product_files_ibfk_2` FOREIGN KEY (`creator_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `product_publication_reviews` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `product_id` int unsigned NOT NULL,
  `status` enum('pending','approved','rejected') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `pending_product` int unsigned GENERATED ALWAYS AS (if((`status` = _utf8mb4'pending'),`product_id`,NULL)) VIRTUAL,
  `submitted_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `decided_at` datetime(6) DEFAULT NULL,
  `decided_by` int unsigned DEFAULT NULL,
  `decision_reason` varchar(48) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `decision_explanation` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `submitted_revision` int unsigned DEFAULT NULL,
  `submitted_snapshot` json DEFAULT NULL,
  `restore_source_id` int unsigned DEFAULT NULL,
  `restore_actor_id` int unsigned DEFAULT NULL,
  `restore_request_key` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `product_review_pending` (`pending_product`),
  KEY `product_review_history` (`product_id`,`status`),
  KEY `product_review_queue` (`status`,`id`),
  KEY `decided_by` (`decided_by`),
  CONSTRAINT `product_publication_reviews_ibfk_1` FOREIGN KEY (`product_id`) REFERENCES `productos` (`id`) ON DELETE CASCADE,
  CONSTRAINT `product_publication_reviews_ibfk_2` FOREIGN KEY (`decided_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `product_storage` (
  `product_id` int unsigned NOT NULL,
  `creator_id` int unsigned NOT NULL,
  `index_state` enum('pending','ready') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `index_revision` int unsigned DEFAULT NULL,
  `directory_name` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`product_id`),
  KEY `creator_id` (`creator_id`),
  CONSTRAINT `product_storage_ibfk_1` FOREIGN KEY (`product_id`) REFERENCES `productos` (`id`),
  CONSTRAINT `product_storage_ibfk_2` FOREIGN KEY (`creator_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `product_versions` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `product_id` int unsigned NOT NULL,
  `version_number` int NOT NULL,
  `snapshot` json NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `version_product_identity` (`product_id`,`id`),
  UNIQUE KEY `product_id` (`product_id`,`version_number`),
  CONSTRAINT `product_versions_ibfk_1` FOREIGN KEY (`product_id`) REFERENCES `productos` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `productos` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `categoria_id` int unsigned NOT NULL,
  `nombre` varchar(120) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `descripcion` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `precio` decimal(10,2) NOT NULL,
  `modelo_url` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `creado_en` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `owner_id` int unsigned DEFAULT NULL,
  `status` enum('Draft','Published','Unlisted','Trash') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'Draft',
  `model_asset_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `current_version_id` int unsigned DEFAULT NULL,
  `trashed_at` datetime DEFAULT NULL,
  `purged_at` datetime DEFAULT NULL,
  `revision` int unsigned NOT NULL DEFAULT '0',
  `moderation_removed` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `fk_producto_categoria` (`categoria_id`),
  KEY `fk_product_owner` (`owner_id`),
  CONSTRAINT `fk_product_owner` FOREIGN KEY (`owner_id`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_producto_categoria` FOREIGN KEY (`categoria_id`) REFERENCES `categorias` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_precio_no_negativo` CHECK ((`precio` >= 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `profile_media` (
  `id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `owner_id` int unsigned NOT NULL,
  `slot` enum('avatar','banner','pin') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `source` enum('upload','roblox') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `mime` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `extension` varchar(5) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `original_sha256` char(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `original_size` int unsigned NOT NULL,
  `display_sha256` char(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `display_size` int unsigned NOT NULL,
  `width` int unsigned NOT NULL,
  `height` int unsigned NOT NULL,
  `metadata` json NOT NULL,
  `created_at` timestamp(6) NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `owner_id` (`owner_id`),
  CONSTRAINT `profile_media_ibfk_1` FOREIGN KEY (`owner_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `profile_media_operations` (
  `id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `owner_id` int unsigned NOT NULL,
  `state` enum('preparing','committed','failed') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `descriptor` json NOT NULL,
  `last_error` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` timestamp(6) NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` timestamp(6) NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `sanction_appeals` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `sanction_id` int unsigned NOT NULL,
  `user_id` int unsigned NOT NULL,
  `explanation` varchar(2000) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` enum('pending','approved','rejected') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `submitted_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `decided_at` datetime(6) DEFAULT NULL,
  `decided_by` int unsigned DEFAULT NULL,
  `decision_reason` varchar(48) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `decision_explanation` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `effect_lifted_at` datetime(6) DEFAULT NULL,
  `decision_revision` int unsigned NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `sanction_id` (`sanction_id`),
  KEY `appeal_queue` (`status`,`id`),
  KEY `user_id` (`user_id`),
  KEY `decided_by` (`decided_by`),
  CONSTRAINT `sanction_appeals_ibfk_1` FOREIGN KEY (`sanction_id`) REFERENCES `account_sanctions` (`id`),
  CONSTRAINT `sanction_appeals_ibfk_2` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`),
  CONSTRAINT `sanction_appeals_ibfk_3` FOREIGN KEY (`decided_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `schema_migrations` (
  `id` varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `applied_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `sessions` (
  `token_hash` char(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `user_id` int unsigned NOT NULL,
  `expires_at` datetime NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `public_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `device_label` varchar(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `browser_label` varchar(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `device_type` enum('desktop','mobile','tablet','unknown') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'unknown',
  `last_active_at` datetime(6) DEFAULT NULL,
  `restricted` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`token_hash`),
  UNIQUE KEY `session_public_id` (`public_id`),
  KEY `user_id` (`user_id`),
  KEY `session_expiry` (`expires_at`),
  CONSTRAINT `sessions_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `social_notifications` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `recipient_id` int unsigned NOT NULL,
  `event_key` varchar(160) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `group_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `context_key` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `category` enum('mentions','replies','new_followers','moderation','verification','orders','following_updates','storage') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `title` varchar(140) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` varchar(300) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `destination` varchar(400) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `post_id` int unsigned DEFAULT NULL,
  `comment_id` int unsigned DEFAULT NULL,
  `product_id` int unsigned DEFAULT NULL,
  `created_at` datetime(6) NOT NULL,
  `group_started_at` datetime(6) NOT NULL,
  `expires_at` datetime(6) NOT NULL,
  `read_at` datetime(6) DEFAULT NULL,
  `dismissed_at` datetime(6) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `notification_event` (`recipient_id`,`event_key`),
  KEY `notification_group` (`recipient_id`,`group_id`),
  KEY `notification_context` (`recipient_id`,`category`,`context_key`,`group_started_at`),
  KEY `notification_expiry` (`expires_at`),
  KEY `post_id` (`post_id`),
  KEY `comment_id` (`comment_id`),
  KEY `product_id` (`product_id`),
  CONSTRAINT `social_notifications_ibfk_1` FOREIGN KEY (`recipient_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `social_notifications_ibfk_2` FOREIGN KEY (`post_id`) REFERENCES `conversation_posts` (`id`) ON DELETE CASCADE,
  CONSTRAINT `social_notifications_ibfk_3` FOREIGN KEY (`comment_id`) REFERENCES `conversation_comments` (`id`) ON DELETE CASCADE,
  CONSTRAINT `social_notifications_ibfk_4` FOREIGN KEY (`product_id`) REFERENCES `productos` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `social_preferences` (
  `user_id` int unsigned NOT NULL,
  `mention_visibility` enum('everyone','followers','following','nobody') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'everyone',
  `mentions` tinyint(1) NOT NULL DEFAULT '1',
  `replies` tinyint(1) NOT NULL DEFAULT '1',
  `new_followers` tinyint(1) NOT NULL DEFAULT '1',
  `following_updates` tinyint(1) NOT NULL DEFAULT '1',
  PRIMARY KEY (`user_id`),
  CONSTRAINT `social_preferences_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `storage_cleanup_operations` (
  `id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `file_key` char(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `state` enum('planned','quarantined','restored','purge_planned','purged') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `descriptor` json NOT NULL,
  `last_error` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updated_at` timestamp(6) NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `quarantined_at` datetime(6) DEFAULT NULL,
  `purge_intent_at` datetime(6) DEFAULT NULL,
  `purged_at` datetime(6) DEFAULT NULL,
  `purge_metadata` json DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `file_key` (`file_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `storage_file_lifecycle` (
  `file_key` char(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `relative_path` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `product_id` int unsigned DEFAULT NULL,
  `asset_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `kind` enum('glb','png','json') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `sha256` char(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `byte_size` int unsigned NOT NULL,
  `unreferenced_since` datetime(6) DEFAULT NULL,
  `loss_pending` tinyint(1) NOT NULL DEFAULT '0',
  `updated_at` timestamp(6) NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `artifact_type` enum('asset','staging') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'asset',
  `artifact_state` enum('preparing','completed','abandoned') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `abandoned_at` datetime(6) DEFAULT NULL,
  `abandonment_reason` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`file_key`),
  KEY `upload_lookup` (`asset_id`),
  KEY `product_hash` (`product_id`,`sha256`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `storage_incorporations` (
  `asset_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `product_id` int unsigned NOT NULL,
  `creator_id` int unsigned NOT NULL,
  `descriptor` json NOT NULL,
  `status` enum('preparing','prepared','committed','superseded','abandoned') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `last_error` varchar(120) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `abandoned_at` datetime(6) DEFAULT NULL,
  `abandonment_reason` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`asset_id`,`product_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `storage_layout_operations` (
  `id` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `state` enum('prepared','moving','completed') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `storage_root` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `backup_path` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `inventory` json NOT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `completed_at` datetime(6) DEFAULT NULL,
  `last_error` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `storage_migrations` (
  `product_id` int unsigned NOT NULL,
  `creator_id` int unsigned NOT NULL,
  `state` enum('preparing','failed','completed') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `inventory` json NOT NULL,
  `last_error` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`product_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `user_blocks` (
  `blocker_id` int unsigned NOT NULL,
  `blocked_id` int unsigned NOT NULL,
  `blocked_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`blocker_id`,`blocked_id`),
  KEY `blocks_recent` (`blocker_id`,`blocked_at`,`blocked_id`),
  KEY `blocks_target` (`blocked_id`),
  CONSTRAINT `fk_blocks_actor` FOREIGN KEY (`blocker_id`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_blocks_target` FOREIGN KEY (`blocked_id`) REFERENCES `users` (`id`),
  CONSTRAINT `chk_blocks_not_self` CHECK ((`blocker_id` <> `blocked_id`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `user_handles` (
  `handle` varchar(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `user_id` int unsigned NOT NULL,
  `reserved_at` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`handle`),
  KEY `handles_owner` (`user_id`),
  CONSTRAINT `user_handles_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `user_profiles` (
  `user_id` int unsigned NOT NULL,
  `display_name` varchar(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `bio` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `socials` json NOT NULL,
  `avatar` json NOT NULL,
  `banner` json NOT NULL,
  `pinned_product_id` int unsigned DEFAULT NULL,
  `pinned_thumbnail_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `revision` int unsigned NOT NULL DEFAULT '1',
  `updated_at` timestamp(6) NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`user_id`),
  KEY `pinned_product_id` (`pinned_product_id`),
  KEY `pinned_thumbnail_id` (`pinned_thumbnail_id`),
  CONSTRAINT `user_profiles_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`),
  CONSTRAINT `user_profiles_ibfk_2` FOREIGN KEY (`pinned_product_id`) REFERENCES `productos` (`id`) ON DELETE SET NULL,
  CONSTRAINT `user_profiles_ibfk_3` FOREIGN KEY (`pinned_thumbnail_id`) REFERENCES `profile_media` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `users` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `username` varchar(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `email` varchar(254) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `password` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `role` enum('user','admin','moderator') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'user',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `admin_slot` tinyint unsigned GENERATED ALWAYS AS (if((`role` = _utf8mb4'admin'),1,NULL)) VIRTUAL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `username` (`username`),
  UNIQUE KEY `email` (`email`),
  UNIQUE KEY `single_admin` (`admin_slot`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `variants` (
  `id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `product_id` int unsigned NOT NULL,
  `name` varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `hex` char(7) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `texture_asset_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `is_default` tinyint(1) NOT NULL DEFAULT '0',
  `legacy` tinyint(1) NOT NULL DEFAULT '0',
  `active` tinyint(1) NOT NULL DEFAULT '1',
  PRIMARY KEY (`id`),
  KEY `product_id` (`product_id`),
  KEY `texture_asset_id` (`texture_asset_id`),
  CONSTRAINT `variants_ibfk_1` FOREIGN KEY (`product_id`) REFERENCES `productos` (`id`),
  CONSTRAINT `variants_ibfk_2` FOREIGN KEY (`texture_asset_id`) REFERENCES `assets` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `version_restorations` (
  `version_id` int unsigned NOT NULL,
  `source_version_id` int unsigned NOT NULL,
  `product_id` int unsigned NOT NULL,
  `actor_id` int unsigned NOT NULL,
  `request_key` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  PRIMARY KEY (`version_id`),
  UNIQUE KEY `product_id` (`product_id`,`request_key`),
  KEY `source_version_id` (`source_version_id`),
  KEY `actor_id` (`actor_id`),
  CONSTRAINT `version_restorations_ibfk_1` FOREIGN KEY (`version_id`) REFERENCES `product_versions` (`id`),
  CONSTRAINT `version_restorations_ibfk_2` FOREIGN KEY (`source_version_id`) REFERENCES `product_versions` (`id`),
  CONSTRAINT `version_restorations_ibfk_3` FOREIGN KEY (`product_id`) REFERENCES `productos` (`id`),
  CONSTRAINT `version_restorations_ibfk_4` FOREIGN KEY (`actor_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `version_variants` (
  `version_id` int unsigned NOT NULL,
  `variant_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `model_asset_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `texture_asset_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`version_id`,`variant_id`),
  KEY `variant_id` (`variant_id`),
  KEY `model_asset_id` (`model_asset_id`),
  KEY `texture_asset_id` (`texture_asset_id`),
  CONSTRAINT `version_variants_ibfk_1` FOREIGN KEY (`version_id`) REFERENCES `product_versions` (`id`),
  CONSTRAINT `version_variants_ibfk_2` FOREIGN KEY (`variant_id`) REFERENCES `variants` (`id`),
  CONSTRAINT `version_variants_ibfk_3` FOREIGN KEY (`model_asset_id`) REFERENCES `assets` (`id`),
  CONSTRAINT `version_variants_ibfk_4` FOREIGN KEY (`texture_asset_id`) REFERENCES `assets` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE product_favorites (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
 user_id INT UNSIGNED NOT NULL,
 product_id INT UNSIGNED NOT NULL,
 variant_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
 created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 PRIMARY KEY(id), UNIQUE KEY favorite_identity(user_id,product_id,variant_id),
 KEY favorite_product(product_id), KEY favorite_variant(variant_id),
 CONSTRAINT favorite_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
 CONSTRAINT favorite_product_fk FOREIGN KEY(product_id) REFERENCES productos(id),
 CONSTRAINT favorite_variant_fk FOREIGN KEY(variant_id) REFERENCES variants(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE social_policy (
 id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
 main_admin_id INT UNSIGNED NOT NULL UNIQUE,
 created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 CONSTRAINT social_policy_singleton CHECK (id=1),
 CONSTRAINT social_policy_admin_fk FOREIGN KEY(main_admin_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `creator_storage_operations` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `owner_id` int unsigned DEFAULT NULL,
  `state` varchar(24) COLLATE utf8mb4_unicode_ci NOT NULL,
  `descriptor` json NOT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `storage_quota_defaults` (
  `role` enum('user','moderator','admin','verified') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `limit_bytes` bigint unsigned DEFAULT NULL,
  `revision` int unsigned NOT NULL DEFAULT '1',
  PRIMARY KEY (`role`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `storage_quota_overrides` (
  `user_id` int unsigned NOT NULL,
  `limit_bytes` bigint unsigned DEFAULT NULL,
  `revision` int unsigned NOT NULL DEFAULT '1',
  PRIMARY KEY (`user_id`),
  CONSTRAINT `fk_storage_quota_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `shopping_bag_items` (
  `user_id` int unsigned NOT NULL,
  `product_id` int unsigned NOT NULL,
  `variant_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `version_id` int unsigned NOT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `revision` int unsigned NOT NULL DEFAULT '0',
  PRIMARY KEY (`user_id`,`product_id`,`variant_id`),
  KEY `bag32_product` (`product_id`),
  KEY `bag32_variant` (`variant_id`),
  KEY `bag32_version` (`version_id`),
  CONSTRAINT `bag32_product` FOREIGN KEY (`product_id`) REFERENCES `productos` (`id`),
  CONSTRAINT `bag32_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`),
  CONSTRAINT `bag32_variant` FOREIGN KEY (`variant_id`) REFERENCES `variants` (`id`),
  CONSTRAINT `bag32_version` FOREIGN KEY (`version_id`) REFERENCES `product_versions` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE product_promotion_drafts(product_id INT UNSIGNED NOT NULL PRIMARY KEY,message VARCHAR(1000) NOT NULL DEFAULT '',CONSTRAINT promotion_draft_product FOREIGN KEY(product_id) REFERENCES productos(id) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE product_promotions(id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,public_id CHAR(36) NOT NULL,product_id INT UNSIGNED NOT NULL,message VARCHAR(1000) NOT NULL DEFAULT '',message_revision INT UNSIGNED NOT NULL DEFAULT 0,published_at DATETIME(6) NOT NULL,UNIQUE KEY promotion_public(public_id),UNIQUE KEY promotion_product(product_id),KEY promotion_order(published_at,id),CONSTRAINT promotion_product_ref FOREIGN KEY(product_id) REFERENCES productos(id) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE product_promotion_reactions(promotion_id BIGINT UNSIGNED NOT NULL,user_id INT UNSIGNED NOT NULL,reaction ENUM('like','love','haha','wow','sad','angry','adore','fire') NOT NULL,PRIMARY KEY(promotion_id,user_id),CONSTRAINT promotion_reaction_post FOREIGN KEY(promotion_id) REFERENCES product_promotions(id) ON DELETE CASCADE,CONSTRAINT promotion_reaction_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE product_promotion_reports(id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,promotion_id BIGINT UNSIGNED NOT NULL,reporter_id INT UNSIGNED NOT NULL,message_revision INT UNSIGNED NOT NULL,message_text VARCHAR(1000) NOT NULL,reason VARCHAR(32) NOT NULL,status ENUM('pending','resolved') NOT NULL DEFAULT 'pending',created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),UNIQUE KEY promotion_report_once(promotion_id,reporter_id,message_revision),CONSTRAINT promotion_report_post FOREIGN KEY(promotion_id) REFERENCES product_promotions(id) ON DELETE CASCADE,CONSTRAINT promotion_report_user FOREIGN KEY(reporter_id) REFERENCES users(id) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE product_promotion_removals(id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,promotion_id BIGINT UNSIGNED NOT NULL,actor_id INT UNSIGNED NULL,message_text VARCHAR(1000) NOT NULL,message_revision INT UNSIGNED NOT NULL,reason VARCHAR(32) NOT NULL,explanation VARCHAR(500) NULL,created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),CONSTRAINT promotion_removal_post FOREIGN KEY(promotion_id) REFERENCES product_promotions(id) ON DELETE CASCADE,CONSTRAINT promotion_removal_actor FOREIGN KEY(actor_id) REFERENCES users(id) ON DELETE SET NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `shopping_bag_items_031_archive` (
  `user_id` int unsigned NOT NULL,
  `product_id` int unsigned NOT NULL,
  `variant_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `version_id` int unsigned NOT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`user_id`,`product_id`,`variant_id`,`version_id`),
  KEY `product_id` (`product_id`),
  KEY `variant_id` (`variant_id`),
  KEY `version_id` (`version_id`),
  CONSTRAINT `shopping_bag_items_031_archive_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`),
  CONSTRAINT `shopping_bag_items_031_archive_ibfk_2` FOREIGN KEY (`product_id`) REFERENCES `productos` (`id`),
  CONSTRAINT `shopping_bag_items_031_archive_ibfk_3` FOREIGN KEY (`variant_id`) REFERENCES `variants` (`id`),
  CONSTRAINT `shopping_bag_items_031_archive_ibfk_4` FOREIGN KEY (`version_id`) REFERENCES `product_versions` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `orders` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `order_number` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `buyer_id` int unsigned NOT NULL,
  `status` enum('pending','completed','cancelled') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `currency` char(3) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'USD',
  `subtotal_cents` bigint unsigned NOT NULL,
  `tax_cents` bigint unsigned NOT NULL DEFAULT '0',
  `total_cents` bigint unsigned NOT NULL,
  `payment_method` enum('free','simulated_card','simulated_paypal') COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `completed_at` datetime(6) DEFAULT NULL,
  `billing_address` json DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `order_number_unique` (`order_number`),
  UNIQUE KEY `order_buyer` (`id`,`buyer_id`),
  KEY `buyer_created` (`buyer_id`,`created_at`),
  KEY `sales_completed` (`status`,`completed_at`,`id`),
  CONSTRAINT `order_buyer_ref` FOREIGN KEY (`buyer_id`) REFERENCES `users` (`id`),
  CONSTRAINT `order_total_check` CHECK (((`total_cents` = (`subtotal_cents` + `tax_cents`)) and (`tax_cents` = 0)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `order_items` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `order_id` bigint unsigned NOT NULL,
  `buyer_id` int unsigned NOT NULL,
  `product_id` int unsigned NOT NULL,
  `variant_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `version_id` int unsigned NOT NULL,
  `price_cents` bigint unsigned NOT NULL,
  `product_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `variant_name` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL,
  `creator_id` int unsigned DEFAULT NULL,
  `acquired_version_number` int unsigned DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `order_variant` (`order_id`,`product_id`,`variant_id`),
  UNIQUE KEY `acquisition_origin` (`id`,`buyer_id`,`product_id`,`variant_id`,`version_id`),
  KEY `ordered_version` (`version_id`,`variant_id`),
  KEY `sales_creator_product` (`creator_id`,`product_id`,`variant_id`),
  KEY `sales_creator_order` (`creator_id`,`order_id`),
  KEY `ordered_buyer` (`order_id`,`buyer_id`),
  KEY `ordered_product` (`product_id`,`version_id`),
  CONSTRAINT `ordered_buyer` FOREIGN KEY (`order_id`, `buyer_id`) REFERENCES `orders` (`id`, `buyer_id`),
  CONSTRAINT `ordered_product` FOREIGN KEY (`product_id`, `version_id`) REFERENCES `product_versions` (`product_id`, `id`),
  CONSTRAINT `ordered_variant` FOREIGN KEY (`version_id`, `variant_id`) REFERENCES `version_variants` (`version_id`, `variant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `acquisitions` (
  `user_id` int unsigned NOT NULL,
  `product_id` int unsigned NOT NULL,
  `variant_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `order_item_id` bigint unsigned NOT NULL,
  `acquired_version_id` int unsigned NOT NULL,
  `acquired_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`user_id`,`product_id`,`variant_id`),
  UNIQUE KEY `acquisition_line` (`order_item_id`),
  KEY `protected_product` (`product_id`),
  KEY `acquisition_origin_ref` (`order_item_id`,`user_id`,`product_id`,`variant_id`,`acquired_version_id`),
  CONSTRAINT `acquisition_origin_ref` FOREIGN KEY (`order_item_id`, `user_id`, `product_id`, `variant_id`, `acquired_version_id`) REFERENCES `order_items` (`id`, `buyer_id`, `product_id`, `variant_id`, `version_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `checkout_quotes` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `buyer_id` int unsigned NOT NULL,
  `fingerprint` char(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `quote_lines` json NOT NULL,
  `change_summary` json NOT NULL,
  `expires_at` datetime(6) NOT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `quote_expiry` (`expires_at`),
  KEY `quote_buyer` (`buyer_id`),
  CONSTRAINT `quote_buyer` FOREIGN KEY (`buyer_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `checkout_attempts` (
  `buyer_id` int unsigned NOT NULL,
  `idempotency_key` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `request_hash` char(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `quote_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` enum('pending','declined','completed','failed') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `order_id` bigint unsigned DEFAULT NULL,
  `result_code` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`buyer_id`,`idempotency_key`),
  UNIQUE KEY `attempt_order` (`order_id`),
  KEY `attempt_quote` (`quote_id`),
  KEY `attempt_order_buyer` (`order_id`,`buyer_id`),
  CONSTRAINT `attempt_buyer` FOREIGN KEY (`buyer_id`) REFERENCES `users` (`id`),
  CONSTRAINT `attempt_order_buyer` FOREIGN KEY (`order_id`, `buyer_id`) REFERENCES `orders` (`id`, `buyer_id`),
  CONSTRAINT `attempt_quote` FOREIGN KEY (`quote_id`) REFERENCES `checkout_quotes` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE checkout_billing_preferences(buyer_id INT UNSIGNED PRIMARY KEY,billing_address JSON NOT NULL,updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),CONSTRAINT checkout_billing_buyer FOREIGN KEY(buyer_id) REFERENCES users(id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE review_moderation_targets (
 id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 review_id VARCHAR(100) NOT NULL,
 product_id INT UNSIGNED NOT NULL,
 author_id INT UNSIGNED NULL,
 label VARCHAR(160) NOT NULL,
 is_anonymous BOOLEAN NOT NULL DEFAULT FALSE,
 created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 UNIQUE KEY review_target_identity(review_id),
 KEY review_target_product(product_id),
 FOREIGN KEY(product_id) REFERENCES productos(id),
 FOREIGN KEY(author_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE collection_pins (
 user_id INT UNSIGNED NOT NULL,
 product_id INT UNSIGNED NOT NULL,
 created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 PRIMARY KEY(user_id,product_id),
 KEY collection_pin_product(product_id),
 CONSTRAINT fk_collection_pin_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
 CONSTRAINT fk_collection_pin_product FOREIGN KEY(product_id) REFERENCES productos(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


START TRANSACTION;
INSERT INTO users(id,username,email,password,role) VALUES (1,'admin','admin@altego.test','default','admin');
INSERT INTO user_handles(handle,user_id) VALUES ('admin',1);
INSERT INTO user_profiles(user_id,display_name,bio,socials,avatar,banner) VALUES (1,'Admin','','[]','{"kind":"default"}','{"kind":"default"}');
INSERT INTO account_settings(user_id) VALUES (1);
INSERT INTO social_policy(id,main_admin_id) VALUES (1,1);
INSERT INTO storage_quota_defaults(role,limit_bytes) VALUES ('user',2147483648),('moderator',5368709120),('verified',4294967296),('admin',NULL);
INSERT INTO categorias(id,nombre,descripcion,icon_svg,display_order) VALUES (1,'Hair','3D hairstyles for avatars','<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"63.0 50.0 672.0 672.0\" role=\"img\" aria-label=\"Hair category icon\">\n  <path fill=\"currentColor\" fill-rule=\"evenodd\" d=\"M 619 409 L 631 422 L 637 432 L 641 436 L 658 470 L 661 479 L 661 482 L 664 489 L 665 499 L 666 500 L 666 507 L 667 508 L 667 532 L 666 533 L 665 543 L 660 558 L 658 561 L 658 563 L 654 571 L 647 581 L 646 580 L 646 577 L 647 576 L 647 569 L 648 568 L 648 542 L 647 541 L 647 536 L 645 531 L 645 527 L 642 521 L 642 519 L 640 515 L 639 515 L 638 531 L 637 532 L 637 537 L 635 542 L 634 550 L 630 558 L 627 568 L 616 587 L 610 595 L 592 612 L 589 613 L 586 616 L 575 622 L 573 622 L 567 625 L 564 625 L 563 624 L 568 614 L 568 612 L 572 604 L 572 601 L 575 595 L 575 592 L 577 587 L 578 577 L 579 576 L 579 570 L 580 569 L 580 540 L 579 539 L 578 528 L 576 524 L 596 503 L 598 499 L 601 496 L 610 478 L 615 463 L 616 454 L 617 453 L 617 447 L 618 446 L 618 410 Z M 180 407 L 181 408 L 181 414 L 180 415 L 180 441 L 181 442 L 181 450 L 182 451 L 182 456 L 183 457 L 184 465 L 189 480 L 197 496 L 207 509 L 222 523 L 218 534 L 216 547 L 215 548 L 215 560 L 214 561 L 215 564 L 215 578 L 216 579 L 216 584 L 217 585 L 218 592 L 222 604 L 233 624 L 232 625 L 227 624 L 213 617 L 204 611 L 186 594 L 180 586 L 170 568 L 170 566 L 166 559 L 163 550 L 161 537 L 160 536 L 159 517 L 158 515 L 153 527 L 153 530 L 151 535 L 151 539 L 150 540 L 150 545 L 149 546 L 149 564 L 150 565 L 150 575 L 151 576 L 151 581 L 150 582 L 144 574 L 137 560 L 137 558 L 133 549 L 132 542 L 131 541 L 130 528 L 129 527 L 130 502 L 131 501 L 132 492 L 134 488 L 134 485 L 139 470 L 148 451 L 150 449 L 155 439 L 166 423 Z M 145 360 L 161 350 L 178 331 L 179 328 L 188 315 L 193 304 L 195 302 L 195 300 L 202 286 L 204 284 L 210 271 L 212 269 L 225 244 L 231 237 L 241 221 L 247 213 L 254 206 L 258 200 L 279 179 L 296 167 L 299 166 L 306 161 L 312 159 L 317 156 L 329 152 L 339 151 L 340 150 L 356 150 L 357 151 L 362 151 L 363 152 L 369 153 L 377 157 L 383 161 L 389 167 L 396 179 L 398 178 L 404 167 L 409 162 L 425 153 L 432 152 L 433 151 L 438 151 L 439 150 L 456 150 L 457 151 L 464 151 L 465 152 L 472 153 L 481 156 L 488 160 L 490 160 L 508 171 L 521 181 L 542 202 L 563 229 L 564 232 L 572 243 L 573 246 L 581 258 L 583 263 L 585 265 L 613 320 L 623 335 L 629 341 L 629 342 L 640 352 L 645 354 L 654 360 L 645 364 L 630 365 L 629 364 L 619 363 L 608 358 L 593 346 L 579 327 L 572 314 L 581 341 L 582 348 L 584 352 L 584 355 L 585 356 L 585 359 L 586 360 L 586 363 L 589 372 L 592 391 L 593 392 L 594 413 L 595 414 L 595 436 L 594 437 L 594 446 L 593 447 L 592 456 L 591 457 L 591 460 L 588 469 L 582 481 L 574 493 L 560 507 L 556 509 L 553 512 L 535 521 L 529 523 L 526 523 L 525 522 L 533 512 L 539 499 L 542 495 L 542 493 L 544 490 L 544 488 L 546 485 L 549 476 L 549 473 L 550 472 L 550 469 L 552 465 L 553 457 L 554 456 L 555 442 L 556 441 L 556 431 L 557 430 L 557 415 L 556 414 L 556 399 L 555 398 L 555 390 L 553 384 L 553 379 L 552 378 L 552 374 L 550 369 L 550 365 L 548 361 L 545 385 L 543 388 L 541 399 L 539 403 L 536 406 L 534 406 L 526 410 L 518 411 L 517 412 L 511 412 L 510 411 L 511 396 L 512 395 L 512 366 L 511 365 L 511 353 L 510 352 L 510 345 L 509 344 L 509 339 L 508 338 L 506 322 L 505 321 L 503 310 L 495 286 L 493 283 L 492 278 L 476 246 L 472 241 L 469 235 L 469 238 L 471 242 L 471 245 L 473 249 L 473 252 L 475 256 L 475 259 L 478 268 L 478 272 L 480 278 L 480 283 L 481 284 L 481 290 L 482 291 L 482 298 L 483 299 L 484 336 L 483 337 L 482 354 L 480 359 L 480 363 L 476 375 L 474 378 L 474 380 L 467 393 L 459 403 L 457 402 L 457 384 L 456 383 L 456 375 L 455 374 L 452 359 L 450 355 L 449 373 L 448 374 L 447 384 L 446 385 L 445 392 L 441 404 L 437 412 L 432 412 L 431 413 L 418 413 L 417 414 L 378 414 L 377 413 L 367 413 L 366 412 L 362 412 L 356 401 L 353 392 L 348 366 L 346 369 L 344 379 L 343 380 L 343 385 L 342 386 L 342 402 L 340 403 L 331 392 L 323 376 L 321 370 L 321 367 L 320 366 L 320 363 L 319 362 L 319 358 L 317 352 L 317 347 L 316 346 L 316 336 L 315 335 L 315 304 L 316 303 L 317 283 L 318 282 L 318 276 L 319 274 L 318 274 L 311 285 L 299 312 L 298 318 L 293 333 L 292 341 L 291 342 L 290 354 L 289 355 L 289 363 L 288 364 L 288 401 L 289 402 L 289 411 L 288 412 L 277 411 L 265 407 L 260 404 L 258 398 L 258 395 L 257 394 L 257 391 L 256 390 L 256 384 L 255 383 L 254 365 L 253 364 L 253 352 L 250 360 L 249 367 L 247 371 L 246 380 L 245 381 L 244 396 L 243 397 L 243 407 L 242 408 L 242 434 L 243 435 L 243 446 L 244 447 L 244 452 L 245 453 L 245 459 L 246 460 L 246 464 L 250 476 L 250 479 L 252 482 L 256 494 L 265 511 L 273 522 L 272 524 L 263 521 L 249 514 L 227 496 L 217 481 L 211 469 L 208 460 L 208 457 L 207 456 L 206 445 L 205 444 L 205 434 L 204 433 L 204 418 L 205 417 L 206 395 L 207 394 L 207 388 L 208 387 L 210 371 L 211 370 L 213 359 L 215 355 L 215 352 L 217 348 L 217 345 L 219 341 L 219 338 L 221 334 L 221 331 L 224 322 L 216 334 L 210 340 L 210 341 L 198 353 L 185 361 L 179 363 L 176 363 L 175 364 L 164 365 L 163 364 L 154 364 Z M 262 154 L 249 165 L 238 176 L 238 177 L 227 188 L 211 209 L 205 220 L 198 229 L 192 241 L 190 243 L 176 270 L 176 272 L 171 280 L 171 282 L 168 288 L 166 290 L 159 305 L 150 319 L 132 338 L 117 349 L 103 357 L 117 372 L 131 382 L 148 389 L 151 389 L 152 390 L 156 390 L 157 391 L 152 398 L 141 410 L 139 414 L 133 421 L 127 433 L 125 435 L 114 459 L 110 471 L 110 474 L 109 475 L 109 478 L 106 487 L 106 492 L 105 493 L 105 500 L 104 501 L 104 529 L 105 530 L 106 542 L 114 567 L 119 577 L 129 592 L 143 607 L 144 607 L 150 613 L 164 622 L 172 625 L 174 620 L 174 616 L 176 615 L 186 625 L 198 634 L 218 644 L 224 646 L 227 646 L 228 647 L 231 647 L 232 648 L 235 648 L 236 649 L 252 650 L 253 651 L 256 650 L 270 650 L 271 649 L 274 649 L 272 644 L 260 626 L 251 608 L 251 606 L 249 603 L 248 598 L 245 592 L 244 584 L 243 583 L 243 578 L 242 577 L 242 568 L 241 567 L 241 558 L 242 557 L 242 549 L 243 548 L 244 540 L 246 538 L 251 541 L 253 541 L 262 545 L 265 545 L 270 547 L 274 547 L 275 548 L 280 548 L 281 549 L 305 549 L 306 548 L 312 548 L 318 546 L 318 544 L 298 520 L 289 507 L 287 502 L 283 497 L 280 491 L 280 489 L 275 479 L 272 470 L 271 463 L 270 462 L 270 458 L 269 457 L 269 453 L 267 447 L 266 434 L 267 433 L 270 433 L 271 434 L 276 434 L 282 436 L 290 436 L 291 437 L 308 437 L 309 436 L 315 436 L 315 424 L 314 423 L 314 409 L 315 408 L 319 414 L 326 421 L 339 432 L 347 437 L 352 437 L 353 438 L 358 438 L 359 439 L 365 439 L 366 440 L 375 440 L 376 441 L 421 441 L 422 440 L 431 440 L 432 439 L 438 439 L 439 438 L 450 437 L 455 435 L 466 427 L 480 413 L 483 408 L 485 407 L 486 408 L 486 413 L 485 414 L 485 420 L 484 421 L 483 436 L 489 436 L 490 437 L 507 437 L 508 436 L 516 436 L 517 435 L 522 435 L 523 434 L 531 433 L 532 434 L 532 442 L 531 443 L 531 449 L 530 450 L 528 464 L 523 479 L 521 482 L 521 484 L 508 509 L 480 546 L 486 547 L 487 548 L 492 548 L 493 549 L 515 549 L 516 548 L 523 548 L 524 547 L 528 547 L 532 545 L 539 544 L 550 539 L 553 540 L 553 546 L 554 547 L 554 566 L 553 567 L 553 574 L 552 575 L 551 585 L 549 589 L 549 592 L 543 610 L 540 615 L 540 617 L 537 622 L 536 626 L 534 628 L 526 645 L 524 647 L 524 649 L 527 649 L 528 650 L 536 650 L 537 651 L 544 651 L 545 650 L 556 650 L 557 649 L 562 649 L 563 648 L 574 646 L 596 636 L 609 627 L 621 615 L 623 616 L 624 624 L 627 625 L 640 618 L 650 610 L 663 597 L 671 587 L 682 567 L 683 562 L 687 553 L 687 550 L 690 542 L 690 537 L 691 536 L 691 528 L 692 527 L 692 504 L 691 503 L 691 493 L 690 492 L 688 479 L 686 475 L 686 472 L 682 460 L 677 450 L 675 443 L 661 418 L 652 405 L 643 395 L 641 391 L 645 389 L 653 388 L 669 381 L 687 367 L 695 357 L 688 352 L 681 349 L 667 339 L 658 331 L 647 318 L 641 307 L 639 305 L 637 300 L 635 298 L 627 282 L 627 280 L 608 243 L 588 211 L 584 207 L 580 200 L 568 185 L 560 177 L 560 176 L 542 159 L 528 148 L 520 144 L 510 137 L 495 130 L 477 124 L 473 124 L 467 122 L 462 122 L 461 121 L 434 121 L 433 122 L 427 122 L 405 129 L 400 132 L 398 132 L 395 130 L 393 130 L 390 128 L 378 124 L 370 123 L 369 122 L 364 122 L 363 121 L 338 121 L 337 122 L 331 122 L 330 123 L 326 123 L 325 124 L 318 125 L 303 130 L 300 132 L 298 132 L 273 146 L 270 149 Z\"/>\n</svg>\n',10);
INSERT INTO categorias(id,nombre,descripcion,icon_svg,display_order) VALUES (2,'Hats','Hats and head accessories','<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"-36.0 18.0 720.0 720.0\" role=\"img\" aria-label=\"Hats category icon\">\n  <path fill=\"currentColor\" fill-rule=\"evenodd\" d=\"M 133 417 L 134 416 L 135 410 L 137 407 L 151 414 L 153 414 L 166 420 L 184 426 L 194 428 L 198 430 L 205 431 L 206 432 L 210 432 L 211 433 L 215 433 L 221 435 L 226 435 L 232 437 L 237 437 L 238 438 L 251 439 L 252 440 L 272 441 L 273 442 L 287 442 L 288 443 L 308 443 L 309 444 L 363 443 L 364 442 L 376 442 L 377 441 L 396 440 L 397 439 L 403 439 L 404 438 L 427 435 L 428 434 L 447 431 L 454 428 L 468 425 L 471 423 L 474 423 L 480 420 L 496 415 L 511 407 L 513 409 L 516 422 L 504 433 L 480 449 L 474 451 L 458 459 L 443 464 L 436 465 L 432 467 L 429 467 L 424 469 L 420 469 L 419 470 L 415 470 L 414 471 L 409 471 L 408 472 L 403 472 L 402 473 L 397 473 L 396 474 L 389 474 L 388 475 L 380 475 L 379 476 L 344 477 L 343 478 L 306 478 L 305 477 L 285 477 L 284 476 L 271 476 L 270 475 L 261 475 L 260 474 L 245 473 L 244 472 L 239 472 L 238 471 L 233 471 L 232 470 L 228 470 L 223 468 L 219 468 L 218 467 L 215 467 L 205 463 L 202 463 L 193 460 L 165 447 L 160 443 L 151 438 L 141 430 L 133 422 Z M 34 402 L 39 389 L 49 379 L 56 375 L 62 373 L 65 373 L 66 372 L 81 372 L 82 373 L 86 373 L 87 374 L 93 375 L 107 382 L 111 385 L 111 390 L 109 394 L 108 401 L 106 405 L 106 408 L 103 417 L 103 427 L 105 431 L 128 453 L 153 470 L 173 480 L 183 483 L 186 485 L 204 491 L 207 491 L 208 492 L 211 492 L 220 495 L 224 495 L 230 497 L 235 497 L 236 498 L 242 498 L 243 499 L 260 500 L 261 501 L 271 501 L 272 502 L 288 502 L 289 503 L 321 503 L 322 504 L 339 504 L 340 503 L 374 502 L 375 501 L 386 501 L 387 500 L 396 500 L 397 499 L 404 499 L 405 498 L 418 497 L 419 496 L 423 496 L 424 495 L 428 495 L 429 494 L 444 491 L 465 484 L 468 482 L 476 480 L 496 470 L 513 459 L 522 451 L 527 448 L 543 432 L 546 426 L 546 419 L 545 418 L 544 410 L 543 409 L 543 406 L 541 402 L 541 399 L 539 395 L 539 392 L 537 386 L 545 380 L 553 376 L 565 372 L 583 372 L 584 373 L 587 373 L 593 375 L 601 380 L 609 388 L 613 396 L 614 403 L 615 404 L 615 417 L 614 418 L 614 423 L 613 424 L 613 427 L 611 433 L 605 446 L 595 462 L 587 472 L 577 482 L 577 483 L 556 503 L 538 517 L 526 525 L 513 532 L 508 536 L 492 544 L 490 544 L 473 552 L 468 553 L 465 555 L 444 562 L 441 562 L 440 563 L 437 563 L 428 566 L 424 566 L 415 569 L 405 570 L 404 571 L 398 571 L 397 572 L 384 573 L 383 574 L 360 575 L 359 576 L 287 576 L 286 575 L 265 574 L 264 573 L 244 571 L 243 570 L 224 567 L 215 564 L 211 564 L 204 561 L 201 561 L 183 555 L 143 537 L 111 517 L 87 498 L 66 477 L 52 460 L 46 449 L 44 447 L 36 429 L 35 421 L 34 420 Z M 144 377 L 147 369 L 150 355 L 152 351 L 153 344 L 159 327 L 160 319 L 164 309 L 164 306 L 166 302 L 168 292 L 171 285 L 171 282 L 174 275 L 174 272 L 181 252 L 181 249 L 184 240 L 186 237 L 188 229 L 193 219 L 193 217 L 203 201 L 213 191 L 223 185 L 229 183 L 234 183 L 235 182 L 245 182 L 246 183 L 255 184 L 261 186 L 272 192 L 274 192 L 282 197 L 284 197 L 290 200 L 292 202 L 307 207 L 320 208 L 321 209 L 337 208 L 338 207 L 343 207 L 347 205 L 350 205 L 360 200 L 362 200 L 370 195 L 389 186 L 395 184 L 398 184 L 399 183 L 403 183 L 404 182 L 420 183 L 429 186 L 434 189 L 443 197 L 450 206 L 456 217 L 456 219 L 460 226 L 461 231 L 463 234 L 468 249 L 468 252 L 473 265 L 475 275 L 478 282 L 478 285 L 482 296 L 483 303 L 486 310 L 488 321 L 490 325 L 491 332 L 493 336 L 494 343 L 498 354 L 500 365 L 504 376 L 504 378 L 502 380 L 488 387 L 486 387 L 476 392 L 468 394 L 465 396 L 459 397 L 441 403 L 437 403 L 432 405 L 428 405 L 427 406 L 423 406 L 422 407 L 418 407 L 412 409 L 407 409 L 406 410 L 392 411 L 391 412 L 381 412 L 380 413 L 371 413 L 370 414 L 358 414 L 357 415 L 327 415 L 326 416 L 324 415 L 315 415 L 314 416 L 313 415 L 291 415 L 290 414 L 268 413 L 267 412 L 260 412 L 259 411 L 252 411 L 251 410 L 238 409 L 237 408 L 232 408 L 231 407 L 227 407 L 222 405 L 212 404 L 211 403 L 196 400 L 178 394 L 170 390 L 165 389 L 156 384 L 154 384 L 146 380 Z M 5 398 L 4 416 L 5 417 L 5 423 L 6 424 L 7 433 L 9 437 L 9 440 L 13 448 L 13 450 L 23 468 L 42 493 L 60 511 L 88 534 L 104 545 L 107 546 L 129 560 L 156 573 L 158 573 L 171 579 L 195 587 L 202 588 L 214 592 L 228 594 L 229 595 L 248 597 L 249 598 L 255 598 L 256 599 L 275 600 L 276 601 L 289 601 L 290 602 L 354 602 L 355 601 L 383 600 L 384 599 L 391 599 L 392 598 L 399 598 L 405 596 L 417 595 L 418 594 L 422 594 L 423 593 L 427 593 L 436 590 L 440 590 L 441 589 L 448 588 L 452 586 L 455 586 L 459 584 L 462 584 L 471 581 L 474 579 L 492 573 L 523 558 L 525 556 L 532 553 L 537 549 L 542 547 L 570 527 L 583 515 L 584 515 L 608 491 L 626 467 L 637 446 L 637 444 L 640 438 L 640 435 L 643 426 L 643 419 L 644 418 L 644 405 L 643 404 L 643 398 L 642 397 L 642 393 L 641 392 L 640 386 L 632 371 L 616 356 L 602 349 L 592 347 L 591 346 L 587 346 L 586 345 L 564 345 L 563 346 L 554 347 L 545 350 L 530 357 L 527 351 L 526 344 L 524 340 L 523 333 L 521 329 L 521 326 L 518 319 L 515 304 L 513 300 L 513 297 L 511 293 L 511 290 L 509 286 L 507 276 L 504 269 L 504 266 L 498 249 L 498 246 L 494 236 L 494 233 L 491 227 L 487 213 L 479 196 L 468 180 L 452 166 L 439 159 L 427 155 L 423 155 L 422 154 L 401 154 L 400 155 L 391 156 L 382 160 L 380 160 L 375 163 L 373 163 L 371 165 L 362 169 L 360 171 L 347 178 L 345 178 L 336 182 L 332 182 L 331 183 L 319 183 L 318 182 L 314 182 L 308 180 L 295 174 L 283 166 L 273 161 L 271 161 L 268 159 L 259 156 L 250 155 L 249 154 L 228 154 L 227 155 L 219 156 L 204 162 L 191 171 L 179 183 L 168 200 L 168 202 L 162 213 L 151 246 L 151 249 L 146 262 L 145 269 L 136 296 L 135 303 L 132 310 L 132 313 L 130 317 L 130 320 L 128 324 L 126 335 L 123 342 L 123 345 L 121 349 L 120 355 L 117 356 L 107 351 L 95 347 L 91 347 L 85 345 L 62 345 L 61 346 L 57 346 L 56 347 L 53 347 L 47 349 L 31 357 L 18 369 L 9 384 L 6 393 L 6 397 Z\"/>\n</svg>\n',20);
INSERT INTO categorias(id,nombre,descripcion,icon_svg,display_order) VALUES (3,'Accessories','3D accessories to customize avatars','<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"26.0 59.5 671.0 671.0\" role=\"img\" aria-label=\"Accessories category icon\">\n  <path fill=\"currentColor\" fill-rule=\"evenodd\" d=\"M 399 398 L 405 395 L 413 389 L 417 385 L 423 376 L 443 386 L 463 399 L 471 403 L 499 425 L 515 442 L 519 448 L 528 458 L 533 466 L 537 470 L 569 520 L 585 551 L 583 552 L 582 551 L 576 551 L 575 550 L 555 548 L 554 547 L 549 547 L 548 546 L 543 546 L 542 545 L 536 545 L 535 544 L 524 543 L 523 542 L 517 542 L 516 541 L 506 541 L 503 542 L 497 546 L 493 553 L 481 568 L 460 599 L 458 600 L 455 596 L 455 594 L 447 576 L 446 571 L 444 568 L 443 563 L 441 560 L 422 503 L 422 500 L 418 489 L 418 486 L 417 485 L 417 482 L 416 481 L 416 478 L 415 477 L 415 474 L 414 473 L 414 470 L 413 469 L 413 466 L 410 457 L 408 444 L 406 439 L 406 435 L 405 434 L 405 430 L 404 429 L 404 425 L 402 419 L 402 414 L 401 413 L 401 408 L 400 407 L 400 401 Z M 324 398 L 323 410 L 322 411 L 322 416 L 321 417 L 321 422 L 320 423 L 319 432 L 316 441 L 316 445 L 313 454 L 313 458 L 312 459 L 312 462 L 311 463 L 306 486 L 304 490 L 303 497 L 301 500 L 300 507 L 295 520 L 295 523 L 291 532 L 291 535 L 287 547 L 285 550 L 284 555 L 282 558 L 280 566 L 274 579 L 269 594 L 265 600 L 261 596 L 255 586 L 246 575 L 227 547 L 224 544 L 218 541 L 200 542 L 199 543 L 193 543 L 192 544 L 181 545 L 175 547 L 161 548 L 160 549 L 149 550 L 148 551 L 142 551 L 141 552 L 138 551 L 155 519 L 157 517 L 167 499 L 175 488 L 176 485 L 182 478 L 185 472 L 211 439 L 231 419 L 235 417 L 247 407 L 276 388 L 289 382 L 291 380 L 299 376 L 302 378 L 304 382 L 314 392 L 322 396 Z M 338 273 L 341 273 L 342 272 L 382 272 L 383 273 L 386 273 L 392 276 L 400 284 L 403 290 L 404 297 L 405 298 L 405 349 L 404 350 L 404 354 L 400 364 L 392 372 L 384 376 L 380 376 L 379 377 L 345 377 L 344 376 L 340 376 L 330 371 L 322 362 L 320 356 L 320 353 L 319 352 L 319 344 L 318 343 L 318 301 L 319 300 L 319 294 L 323 284 L 330 277 Z M 165 179 L 166 180 L 170 180 L 171 181 L 184 183 L 199 188 L 202 190 L 214 194 L 222 199 L 235 205 L 254 217 L 271 230 L 277 236 L 285 242 L 304 261 L 306 264 L 306 266 L 300 274 L 296 284 L 295 296 L 294 297 L 294 305 L 293 306 L 268 298 L 264 298 L 258 296 L 252 296 L 251 295 L 239 295 L 238 294 L 212 296 L 211 297 L 207 297 L 206 298 L 199 299 L 191 303 L 196 305 L 203 305 L 204 306 L 211 306 L 212 307 L 228 309 L 240 313 L 243 313 L 247 315 L 250 315 L 256 318 L 266 321 L 269 323 L 271 323 L 288 332 L 295 338 L 295 354 L 293 356 L 288 357 L 285 359 L 273 363 L 254 372 L 252 374 L 241 379 L 239 381 L 230 385 L 228 387 L 209 397 L 202 402 L 170 418 L 165 419 L 162 421 L 153 424 L 145 425 L 144 426 L 136 426 L 135 427 L 132 426 L 125 426 L 117 423 L 108 415 L 103 406 L 101 400 L 101 397 L 100 396 L 100 392 L 99 391 L 99 384 L 98 383 L 99 366 L 100 365 L 100 360 L 101 359 L 102 352 L 109 331 L 109 315 L 108 314 L 108 310 L 104 298 L 102 295 L 99 286 L 99 283 L 96 274 L 96 267 L 95 266 L 95 243 L 96 242 L 96 236 L 97 235 L 98 227 L 103 212 L 112 196 L 120 188 L 126 184 L 135 180 L 139 180 L 140 179 Z M 550 180 L 564 179 L 565 178 L 575 178 L 576 179 L 584 179 L 585 180 L 588 180 L 599 185 L 611 196 L 618 207 L 621 216 L 623 219 L 623 222 L 626 231 L 626 235 L 627 236 L 627 243 L 628 244 L 628 264 L 627 265 L 627 271 L 626 272 L 624 285 L 621 291 L 614 313 L 614 330 L 615 331 L 615 335 L 619 345 L 619 348 L 621 352 L 621 355 L 623 360 L 623 364 L 624 365 L 624 390 L 623 391 L 623 396 L 622 397 L 621 403 L 619 406 L 618 410 L 614 416 L 607 422 L 597 426 L 579 426 L 574 424 L 570 424 L 561 421 L 558 419 L 556 419 L 553 417 L 551 417 L 530 407 L 528 405 L 521 402 L 509 394 L 488 383 L 479 377 L 457 366 L 455 366 L 448 362 L 433 357 L 428 354 L 429 337 L 439 330 L 448 326 L 454 322 L 491 310 L 495 310 L 496 309 L 504 308 L 505 307 L 518 306 L 519 305 L 528 305 L 529 304 L 532 304 L 532 303 L 524 299 L 521 299 L 516 297 L 512 297 L 511 296 L 506 296 L 505 295 L 474 295 L 473 296 L 460 297 L 445 302 L 442 302 L 433 306 L 430 306 L 429 305 L 429 294 L 428 293 L 427 283 L 424 277 L 424 275 L 418 266 L 419 262 L 438 242 L 444 238 L 456 227 L 463 223 L 467 219 L 474 215 L 480 210 L 507 195 L 509 195 L 519 190 L 527 188 L 530 186 L 539 183 L 546 182 Z M 87 180 L 80 191 L 80 193 L 74 205 L 70 217 L 70 221 L 69 222 L 68 230 L 67 231 L 67 238 L 66 239 L 66 270 L 67 271 L 67 275 L 68 276 L 68 281 L 69 282 L 70 289 L 73 296 L 74 302 L 78 310 L 79 317 L 80 318 L 80 327 L 79 328 L 78 336 L 76 339 L 75 345 L 72 353 L 72 356 L 71 357 L 70 373 L 69 374 L 70 396 L 71 397 L 71 401 L 72 402 L 72 406 L 74 410 L 74 413 L 84 433 L 95 444 L 107 451 L 117 453 L 118 454 L 122 454 L 123 455 L 144 455 L 145 454 L 155 453 L 166 449 L 169 450 L 161 460 L 160 463 L 154 470 L 142 488 L 140 493 L 126 515 L 121 526 L 116 533 L 111 543 L 111 545 L 109 547 L 104 558 L 104 568 L 106 572 L 112 578 L 118 580 L 122 580 L 123 579 L 149 577 L 150 576 L 156 576 L 157 575 L 162 575 L 163 574 L 170 574 L 171 573 L 176 573 L 177 572 L 182 572 L 183 571 L 189 571 L 190 570 L 207 568 L 214 576 L 216 580 L 222 587 L 224 591 L 230 598 L 232 602 L 235 605 L 237 609 L 251 627 L 256 635 L 262 639 L 272 639 L 275 638 L 280 633 L 287 620 L 287 618 L 292 609 L 292 607 L 301 588 L 306 573 L 308 570 L 310 562 L 312 559 L 314 551 L 316 548 L 320 536 L 320 533 L 322 530 L 325 521 L 325 518 L 328 511 L 328 508 L 330 504 L 332 494 L 335 487 L 335 483 L 337 479 L 337 475 L 341 463 L 341 459 L 342 458 L 343 450 L 345 445 L 346 435 L 347 434 L 347 430 L 348 429 L 348 425 L 349 424 L 349 420 L 351 414 L 352 404 L 354 402 L 370 402 L 372 405 L 373 417 L 374 418 L 374 422 L 375 423 L 378 442 L 380 447 L 380 451 L 381 452 L 381 455 L 383 460 L 383 464 L 385 469 L 385 473 L 389 485 L 391 496 L 394 503 L 395 510 L 398 516 L 398 519 L 401 526 L 401 529 L 408 550 L 410 553 L 415 570 L 422 585 L 423 590 L 439 625 L 441 627 L 444 634 L 447 637 L 455 640 L 464 638 L 469 633 L 471 629 L 478 621 L 499 590 L 516 568 L 528 569 L 534 571 L 547 572 L 548 573 L 560 574 L 561 575 L 568 575 L 569 576 L 592 578 L 593 579 L 608 579 L 611 578 L 617 573 L 620 562 L 619 561 L 619 557 L 614 547 L 612 545 L 605 530 L 603 528 L 599 519 L 597 517 L 588 500 L 583 494 L 573 476 L 570 473 L 564 463 L 554 450 L 557 449 L 561 451 L 564 451 L 572 454 L 577 454 L 578 455 L 600 455 L 601 454 L 609 453 L 618 449 L 620 449 L 629 443 L 640 431 L 647 418 L 650 409 L 650 406 L 651 405 L 651 401 L 653 395 L 654 373 L 653 372 L 652 357 L 651 356 L 648 341 L 646 338 L 644 328 L 643 327 L 643 317 L 655 281 L 655 276 L 656 275 L 656 270 L 657 269 L 657 239 L 656 238 L 656 231 L 655 230 L 654 221 L 647 199 L 641 187 L 635 178 L 622 165 L 607 156 L 598 153 L 595 153 L 590 151 L 584 151 L 583 150 L 561 150 L 560 151 L 553 151 L 552 152 L 547 152 L 546 153 L 542 153 L 541 154 L 534 155 L 521 160 L 518 160 L 515 162 L 510 163 L 503 167 L 501 167 L 483 176 L 481 178 L 474 181 L 458 192 L 452 195 L 422 219 L 393 249 L 385 248 L 384 247 L 376 247 L 375 246 L 351 246 L 350 247 L 339 247 L 334 249 L 330 249 L 298 216 L 281 202 L 267 192 L 264 191 L 248 180 L 239 176 L 237 174 L 229 170 L 227 170 L 216 164 L 214 164 L 206 160 L 200 158 L 197 158 L 186 154 L 182 154 L 181 153 L 177 153 L 171 151 L 164 151 L 163 150 L 142 150 L 141 151 L 129 152 L 109 160 L 98 168 Z\"/>\n</svg>\n',30);
INSERT INTO productos(id,categoria_id,nombre,descripcion,precio,owner_id,status,model_asset_id,current_version_id,revision) VALUES (1,1,'Hair 1','Academic sample accessory by Shakiara.',0,1,'Published','ab7d911c-73e7-4dfd-a57d-d58f66bc8ab5',1,1);
INSERT INTO assets(id,owner_id,kind,sha256,byte_size,metadata,storage_layout,product_id) VALUES ('448eb6bc-4681-4363-a83e-daff5c218759',1,'png','226cc5d7b6377d944b4f97da7b0cca1d1b9b49063ff7e9876236cb9069211389',209100,'{\"width\":1024,\"height\":1024}','product',1);
INSERT INTO product_files(id,product_id,creator_id,kind,sha256,byte_size,storage_version) VALUES (1,1,1,'png','226cc5d7b6377d944b4f97da7b0cca1d1b9b49063ff7e9876236cb9069211389',209100,1);
INSERT INTO asset_file_links(asset_id,representation,file_id,product_id) VALUES ('448eb6bc-4681-4363-a83e-daff5c218759','original',1,1);
INSERT INTO asset_file_links(asset_id,representation,file_id,product_id) VALUES ('448eb6bc-4681-4363-a83e-daff5c218759','preview',1,1);
INSERT INTO assets(id,owner_id,kind,sha256,byte_size,metadata,storage_layout,product_id) VALUES ('43d4d287-6041-4030-adcf-58316f1691e5',1,'png','3a9d3225d1cbab1082bd0a62cb49436db66a44f7fcab94b4726968949b8ea1db',633366,'{\"width\":1024,\"height\":1024}','product',1);
INSERT INTO product_files(id,product_id,creator_id,kind,sha256,byte_size,storage_version) VALUES (2,1,1,'png','3a9d3225d1cbab1082bd0a62cb49436db66a44f7fcab94b4726968949b8ea1db',633366,1);
INSERT INTO asset_file_links(asset_id,representation,file_id,product_id) VALUES ('43d4d287-6041-4030-adcf-58316f1691e5','original',2,1);
INSERT INTO asset_file_links(asset_id,representation,file_id,product_id) VALUES ('43d4d287-6041-4030-adcf-58316f1691e5','preview',2,1);
INSERT INTO assets(id,owner_id,kind,sha256,byte_size,metadata,storage_layout,product_id) VALUES ('4b94a715-9c70-4d86-a845-e2b286a59b1c',1,'png','9c861688a415695ebb24d79a8ff3b08c40a33907f2b2c23fbe5e297925f50bde',704173,'{\"width\":1024,\"height\":1024}','product',1);
INSERT INTO product_files(id,product_id,creator_id,kind,sha256,byte_size,storage_version) VALUES (3,1,1,'png','9c861688a415695ebb24d79a8ff3b08c40a33907f2b2c23fbe5e297925f50bde',704173,1);
INSERT INTO asset_file_links(asset_id,representation,file_id,product_id) VALUES ('4b94a715-9c70-4d86-a845-e2b286a59b1c','original',3,1);
INSERT INTO asset_file_links(asset_id,representation,file_id,product_id) VALUES ('4b94a715-9c70-4d86-a845-e2b286a59b1c','preview',3,1);
INSERT INTO assets(id,owner_id,kind,sha256,byte_size,metadata,storage_layout,product_id) VALUES ('9dff52d4-7e4e-4f84-a239-5e9c12be7bca',1,'png','071908c4b4dd034858b0f621a19f8ac1c2e9cca6f8488541bdb531b0f125c124',539580,'{\"width\":1024,\"height\":1024}','product',1);
INSERT INTO product_files(id,product_id,creator_id,kind,sha256,byte_size,storage_version) VALUES (4,1,1,'png','071908c4b4dd034858b0f621a19f8ac1c2e9cca6f8488541bdb531b0f125c124',539580,1);
INSERT INTO asset_file_links(asset_id,representation,file_id,product_id) VALUES ('9dff52d4-7e4e-4f84-a239-5e9c12be7bca','original',4,1);
INSERT INTO asset_file_links(asset_id,representation,file_id,product_id) VALUES ('9dff52d4-7e4e-4f84-a239-5e9c12be7bca','preview',4,1);
INSERT INTO assets(id,owner_id,kind,sha256,byte_size,metadata,storage_layout,product_id) VALUES ('c10bf070-bbcf-4944-a249-f36c6e952d84',1,'png','c89106e2353ca2fbd3de921a17c4b6caedb8ae0fa6682b0f1ef80f45a8aebca0',597357,'{\"width\":1024,\"height\":1024}','product',1);
INSERT INTO product_files(id,product_id,creator_id,kind,sha256,byte_size,storage_version) VALUES (5,1,1,'png','c89106e2353ca2fbd3de921a17c4b6caedb8ae0fa6682b0f1ef80f45a8aebca0',597357,1);
INSERT INTO asset_file_links(asset_id,representation,file_id,product_id) VALUES ('c10bf070-bbcf-4944-a249-f36c6e952d84','original',5,1);
INSERT INTO asset_file_links(asset_id,representation,file_id,product_id) VALUES ('c10bf070-bbcf-4944-a249-f36c6e952d84','preview',5,1);
INSERT INTO assets(id,owner_id,kind,sha256,byte_size,metadata,storage_layout,product_id) VALUES ('7ff95eac-7e18-43dc-a9b3-5e4fabbf790d',1,'png','7bad587fa06cade67f8db4ca9e41f616ca9c893d7c365632c73cb6c2555cbf46',426353,'{\"width\":1024,\"height\":1024}','product',1);
INSERT INTO product_files(id,product_id,creator_id,kind,sha256,byte_size,storage_version) VALUES (6,1,1,'png','7bad587fa06cade67f8db4ca9e41f616ca9c893d7c365632c73cb6c2555cbf46',426353,1);
INSERT INTO asset_file_links(asset_id,representation,file_id,product_id) VALUES ('7ff95eac-7e18-43dc-a9b3-5e4fabbf790d','original',6,1);
INSERT INTO asset_file_links(asset_id,representation,file_id,product_id) VALUES ('7ff95eac-7e18-43dc-a9b3-5e4fabbf790d','preview',6,1);
INSERT INTO assets(id,owner_id,kind,sha256,byte_size,metadata,storage_layout,product_id) VALUES ('6939b4f7-8f18-4c71-a5f8-8014e269aaf3',1,'png','a248626bac3b5530e8fefb248932e2c609bfec1d5619b51ac7687566037a1079',486184,'{\"width\":1024,\"height\":1024}','product',1);
INSERT INTO product_files(id,product_id,creator_id,kind,sha256,byte_size,storage_version) VALUES (7,1,1,'png','a248626bac3b5530e8fefb248932e2c609bfec1d5619b51ac7687566037a1079',486184,1);
INSERT INTO asset_file_links(asset_id,representation,file_id,product_id) VALUES ('6939b4f7-8f18-4c71-a5f8-8014e269aaf3','original',7,1);
INSERT INTO asset_file_links(asset_id,representation,file_id,product_id) VALUES ('6939b4f7-8f18-4c71-a5f8-8014e269aaf3','preview',7,1);
INSERT INTO assets(id,owner_id,kind,sha256,byte_size,metadata,storage_layout,product_id) VALUES ('fc491038-a85f-4128-a5fd-73bd5c4d7984',1,'png','e31c0d2daf68f3c1010daabb4c1df6b4a34200bedfe3fda7ed8306674d7505e4',588011,'{\"width\":1024,\"height\":1024}','product',1);
INSERT INTO product_files(id,product_id,creator_id,kind,sha256,byte_size,storage_version) VALUES (8,1,1,'png','e31c0d2daf68f3c1010daabb4c1df6b4a34200bedfe3fda7ed8306674d7505e4',588011,1);
INSERT INTO asset_file_links(asset_id,representation,file_id,product_id) VALUES ('fc491038-a85f-4128-a5fd-73bd5c4d7984','original',8,1);
INSERT INTO asset_file_links(asset_id,representation,file_id,product_id) VALUES ('fc491038-a85f-4128-a5fd-73bd5c4d7984','preview',8,1);
INSERT INTO assets(id,owner_id,kind,sha256,byte_size,metadata,storage_layout,product_id) VALUES ('405bd613-c64c-417a-a7f5-86de2c8703fe',1,'png','5117fc9dde2d17e60ab3f9772079ea24f2795a2542a228422cc1879a6d1877ab',572201,'{\"width\":1024,\"height\":1024}','product',1);
INSERT INTO product_files(id,product_id,creator_id,kind,sha256,byte_size,storage_version) VALUES (9,1,1,'png','5117fc9dde2d17e60ab3f9772079ea24f2795a2542a228422cc1879a6d1877ab',572201,1);
INSERT INTO asset_file_links(asset_id,representation,file_id,product_id) VALUES ('405bd613-c64c-417a-a7f5-86de2c8703fe','original',9,1);
INSERT INTO asset_file_links(asset_id,representation,file_id,product_id) VALUES ('405bd613-c64c-417a-a7f5-86de2c8703fe','preview',9,1);
INSERT INTO assets(id,owner_id,kind,sha256,byte_size,metadata,storage_layout,product_id) VALUES ('647d5385-c3c2-47aa-a5e8-893eaee61de1',1,'png','c408e20b63e785bd1417dd1552452151dd0efd7d9803f3e2ce9f6be43b670083',540217,'{\"width\":1024,\"height\":1024}','product',1);
INSERT INTO product_files(id,product_id,creator_id,kind,sha256,byte_size,storage_version) VALUES (10,1,1,'png','c408e20b63e785bd1417dd1552452151dd0efd7d9803f3e2ce9f6be43b670083',540217,1);
INSERT INTO asset_file_links(asset_id,representation,file_id,product_id) VALUES ('647d5385-c3c2-47aa-a5e8-893eaee61de1','original',10,1);
INSERT INTO asset_file_links(asset_id,representation,file_id,product_id) VALUES ('647d5385-c3c2-47aa-a5e8-893eaee61de1','preview',10,1);
INSERT INTO assets(id,owner_id,kind,sha256,byte_size,metadata,storage_layout,product_id) VALUES ('e7ca7629-87a7-4aaf-a260-7193156df9e3',1,'png','1f47661b9aadb4fbfc110331d7faa7a856c2e8fbfc73647bd95b00073493adb6',424853,'{\"width\":1024,\"height\":1024}','product',1);
INSERT INTO product_files(id,product_id,creator_id,kind,sha256,byte_size,storage_version) VALUES (11,1,1,'png','1f47661b9aadb4fbfc110331d7faa7a856c2e8fbfc73647bd95b00073493adb6',424853,1);
INSERT INTO asset_file_links(asset_id,representation,file_id,product_id) VALUES ('e7ca7629-87a7-4aaf-a260-7193156df9e3','original',11,1);
INSERT INTO asset_file_links(asset_id,representation,file_id,product_id) VALUES ('e7ca7629-87a7-4aaf-a260-7193156df9e3','preview',11,1);
INSERT INTO assets(id,owner_id,kind,sha256,byte_size,metadata,storage_layout,product_id) VALUES ('d084fe9d-35c6-4bc0-ad8e-88ed976b95d9',1,'png','36a1c559ded5a101cee5390d0fe08f7eb49af5547bf9fbdeda0ac06f6881a1f5',218241,'{\"width\":1024,\"height\":1024}','product',1);
INSERT INTO product_files(id,product_id,creator_id,kind,sha256,byte_size,storage_version) VALUES (12,1,1,'png','36a1c559ded5a101cee5390d0fe08f7eb49af5547bf9fbdeda0ac06f6881a1f5',218241,1);
INSERT INTO asset_file_links(asset_id,representation,file_id,product_id) VALUES ('d084fe9d-35c6-4bc0-ad8e-88ed976b95d9','original',12,1);
INSERT INTO asset_file_links(asset_id,representation,file_id,product_id) VALUES ('d084fe9d-35c6-4bc0-ad8e-88ed976b95d9','preview',12,1);
INSERT INTO assets(id,owner_id,kind,sha256,byte_size,metadata,storage_layout,product_id) VALUES ('ab7d911c-73e7-4dfd-a57d-d58f66bc8ab5',1,'glb','c24d8eea064e67e3d0558268a87b76163e67a5b48ae3c5e51fabe156b26f1e2b',543132,'{\"compatible\":true,\"materials\":2}','product',1);
INSERT INTO product_files(id,product_id,creator_id,kind,sha256,byte_size,storage_version) VALUES (13,1,1,'glb','c24d8eea064e67e3d0558268a87b76163e67a5b48ae3c5e51fabe156b26f1e2b',543132,1);
INSERT INTO asset_file_links(asset_id,representation,file_id,product_id) VALUES ('ab7d911c-73e7-4dfd-a57d-d58f66bc8ab5','original',13,1);
INSERT INTO asset_file_links(asset_id,representation,file_id,product_id) VALUES ('ab7d911c-73e7-4dfd-a57d-d58f66bc8ab5','preview',13,1);
INSERT INTO variants(id,product_id,name,hex,texture_asset_id,is_default) VALUES ('7d118493-e6ec-424a-a096-a36bc51f72f3',1,'Black Png','#171612','448eb6bc-4681-4363-a83e-daff5c218759',1);
INSERT INTO variants(id,product_id,name,hex,texture_asset_id,is_default) VALUES ('0b5e756c-0cd4-4bbe-a08d-092d9e715a1e',1,'Blonde Png','#ddc9b6','43d4d287-6041-4030-adcf-58316f1691e5',0);
INSERT INTO variants(id,product_id,name,hex,texture_asset_id,is_default) VALUES ('8864d59b-1471-4cf4-ada2-4ce05f7cbcfb',1,'Blonde L Png','#94816c','4b94a715-9c70-4d86-a845-e2b286a59b1c',0);
INSERT INTO variants(id,product_id,name,hex,texture_asset_id,is_default) VALUES ('333dbb9f-9f22-4d10-a3fe-b767718dbb88',1,'Brown Gray Png','#4d453c','9dff52d4-7e4e-4f84-a239-5e9c12be7bca',0);
INSERT INTO variants(id,product_id,name,hex,texture_asset_id,is_default) VALUES ('420cd16c-422a-4c1e-ad61-2fdf4c0e9b93',1,'Brown L Png','#67493b','c10bf070-bbcf-4944-a249-f36c6e952d84',0);
INSERT INTO variants(id,product_id,name,hex,texture_asset_id,is_default) VALUES ('eaee5ce0-19a3-4896-aa78-572d0f3a898b',1,'Cherry Png','#3d2020','7ff95eac-7e18-43dc-a9b3-5e4fabbf790d',0);
INSERT INTO variants(id,product_id,name,hex,texture_asset_id,is_default) VALUES ('04e6f2e4-150d-42dd-ad01-e5e258dd5aea',1,'Gray Png','#5f5e5e','6939b4f7-8f18-4c71-a5f8-8014e269aaf3',0);
INSERT INTO variants(id,product_id,name,hex,texture_asset_id,is_default) VALUES ('f3a86157-b735-420e-ab2b-57c78713b64d',1,'Pink Png','#b3a2a3','fc491038-a85f-4128-a5fd-73bd5c4d7984',0);
INSERT INTO variants(id,product_id,name,hex,texture_asset_id,is_default) VALUES ('9ed6c02c-e677-4ceb-a361-29a3221a9fa9',1,'Red Png','#823837','405bd613-c64c-417a-a7f5-86de2c8703fe',0);
INSERT INTO variants(id,product_id,name,hex,texture_asset_id,is_default) VALUES ('22deb74a-1f7c-4823-a98a-35032e276c9d',1,'Teal Png','#5f8d89','647d5385-c3c2-47aa-a5e8-893eaee61de1',0);
INSERT INTO variants(id,product_id,name,hex,texture_asset_id,is_default) VALUES ('265aa5bf-001f-4bcf-aeb4-0e22b1d80252',1,'White Gray Png','#a7a6a2','e7ca7629-87a7-4aaf-a260-7193156df9e3',0);
INSERT INTO variants(id,product_id,name,hex,texture_asset_id,is_default) VALUES ('5bdf84d0-de33-4dd7-a8d3-09b9182b6ef1',1,'White Png','#dcdbd7','d084fe9d-35c6-4bc0-ad8e-88ed976b95d9',0);
INSERT INTO product_versions(id,product_id,version_number,snapshot) VALUES (1,1,1,'{\"id\":1,\"owner_id\":1,\"creator_name\":\"Admin\",\"name\":\"Hair 1\",\"description\":\"Academic sample accessory by Shakiara.\",\"category_id\":1,\"category\":\"Hair\",\"price\":0,\"model_asset_id\":\"ab7d911c-73e7-4dfd-a57d-d58f66bc8ab5\",\"model_url\":\"/api/previews/ab7d911c-73e7-4dfd-a57d-d58f66bc8ab5\",\"status\":\"Published\",\"revision\":1,\"current_version_id\":1,\"version_number\":1,\"trashed_at\":null,\"variants\":[{\"id\":\"7d118493-e6ec-424a-a096-a36bc51f72f3\",\"product_id\":1,\"name\":\"Black Png\",\"hex\":\"#171612\",\"texture_asset_id\":\"448eb6bc-4681-4363-a83e-daff5c218759\",\"texture_url\":\"/api/previews/448eb6bc-4681-4363-a83e-daff5c218759\",\"is_default\":true,\"legacy\":false,\"active\":true},{\"id\":\"0b5e756c-0cd4-4bbe-a08d-092d9e715a1e\",\"product_id\":1,\"name\":\"Blonde Png\",\"hex\":\"#ddc9b6\",\"texture_asset_id\":\"43d4d287-6041-4030-adcf-58316f1691e5\",\"texture_url\":\"/api/previews/43d4d287-6041-4030-adcf-58316f1691e5\",\"is_default\":false,\"legacy\":false,\"active\":true},{\"id\":\"8864d59b-1471-4cf4-ada2-4ce05f7cbcfb\",\"product_id\":1,\"name\":\"Blonde L Png\",\"hex\":\"#94816c\",\"texture_asset_id\":\"4b94a715-9c70-4d86-a845-e2b286a59b1c\",\"texture_url\":\"/api/previews/4b94a715-9c70-4d86-a845-e2b286a59b1c\",\"is_default\":false,\"legacy\":false,\"active\":true},{\"id\":\"333dbb9f-9f22-4d10-a3fe-b767718dbb88\",\"product_id\":1,\"name\":\"Brown Gray Png\",\"hex\":\"#4d453c\",\"texture_asset_id\":\"9dff52d4-7e4e-4f84-a239-5e9c12be7bca\",\"texture_url\":\"/api/previews/9dff52d4-7e4e-4f84-a239-5e9c12be7bca\",\"is_default\":false,\"legacy\":false,\"active\":true},{\"id\":\"420cd16c-422a-4c1e-ad61-2fdf4c0e9b93\",\"product_id\":1,\"name\":\"Brown L Png\",\"hex\":\"#67493b\",\"texture_asset_id\":\"c10bf070-bbcf-4944-a249-f36c6e952d84\",\"texture_url\":\"/api/previews/c10bf070-bbcf-4944-a249-f36c6e952d84\",\"is_default\":false,\"legacy\":false,\"active\":true},{\"id\":\"eaee5ce0-19a3-4896-aa78-572d0f3a898b\",\"product_id\":1,\"name\":\"Cherry Png\",\"hex\":\"#3d2020\",\"texture_asset_id\":\"7ff95eac-7e18-43dc-a9b3-5e4fabbf790d\",\"texture_url\":\"/api/previews/7ff95eac-7e18-43dc-a9b3-5e4fabbf790d\",\"is_default\":false,\"legacy\":false,\"active\":true},{\"id\":\"04e6f2e4-150d-42dd-ad01-e5e258dd5aea\",\"product_id\":1,\"name\":\"Gray Png\",\"hex\":\"#5f5e5e\",\"texture_asset_id\":\"6939b4f7-8f18-4c71-a5f8-8014e269aaf3\",\"texture_url\":\"/api/previews/6939b4f7-8f18-4c71-a5f8-8014e269aaf3\",\"is_default\":false,\"legacy\":false,\"active\":true},{\"id\":\"f3a86157-b735-420e-ab2b-57c78713b64d\",\"product_id\":1,\"name\":\"Pink Png\",\"hex\":\"#b3a2a3\",\"texture_asset_id\":\"fc491038-a85f-4128-a5fd-73bd5c4d7984\",\"texture_url\":\"/api/previews/fc491038-a85f-4128-a5fd-73bd5c4d7984\",\"is_default\":false,\"legacy\":false,\"active\":true},{\"id\":\"9ed6c02c-e677-4ceb-a361-29a3221a9fa9\",\"product_id\":1,\"name\":\"Red Png\",\"hex\":\"#823837\",\"texture_asset_id\":\"405bd613-c64c-417a-a7f5-86de2c8703fe\",\"texture_url\":\"/api/previews/405bd613-c64c-417a-a7f5-86de2c8703fe\",\"is_default\":false,\"legacy\":false,\"active\":true},{\"id\":\"22deb74a-1f7c-4823-a98a-35032e276c9d\",\"product_id\":1,\"name\":\"Teal Png\",\"hex\":\"#5f8d89\",\"texture_asset_id\":\"647d5385-c3c2-47aa-a5e8-893eaee61de1\",\"texture_url\":\"/api/previews/647d5385-c3c2-47aa-a5e8-893eaee61de1\",\"is_default\":false,\"legacy\":false,\"active\":true},{\"id\":\"265aa5bf-001f-4bcf-aeb4-0e22b1d80252\",\"product_id\":1,\"name\":\"White Gray Png\",\"hex\":\"#a7a6a2\",\"texture_asset_id\":\"e7ca7629-87a7-4aaf-a260-7193156df9e3\",\"texture_url\":\"/api/previews/e7ca7629-87a7-4aaf-a260-7193156df9e3\",\"is_default\":false,\"legacy\":false,\"active\":true},{\"id\":\"5bdf84d0-de33-4dd7-a8d3-09b9182b6ef1\",\"product_id\":1,\"name\":\"White Png\",\"hex\":\"#dcdbd7\",\"texture_asset_id\":\"d084fe9d-35c6-4bc0-ad8e-88ed976b95d9\",\"texture_url\":\"/api/previews/d084fe9d-35c6-4bc0-ad8e-88ed976b95d9\",\"is_default\":false,\"legacy\":false,\"active\":true}]}');
INSERT INTO version_variants(version_id,variant_id,model_asset_id,texture_asset_id) VALUES (1,'7d118493-e6ec-424a-a096-a36bc51f72f3','ab7d911c-73e7-4dfd-a57d-d58f66bc8ab5','448eb6bc-4681-4363-a83e-daff5c218759');
INSERT INTO version_variants(version_id,variant_id,model_asset_id,texture_asset_id) VALUES (1,'0b5e756c-0cd4-4bbe-a08d-092d9e715a1e','ab7d911c-73e7-4dfd-a57d-d58f66bc8ab5','43d4d287-6041-4030-adcf-58316f1691e5');
INSERT INTO version_variants(version_id,variant_id,model_asset_id,texture_asset_id) VALUES (1,'8864d59b-1471-4cf4-ada2-4ce05f7cbcfb','ab7d911c-73e7-4dfd-a57d-d58f66bc8ab5','4b94a715-9c70-4d86-a845-e2b286a59b1c');
INSERT INTO version_variants(version_id,variant_id,model_asset_id,texture_asset_id) VALUES (1,'333dbb9f-9f22-4d10-a3fe-b767718dbb88','ab7d911c-73e7-4dfd-a57d-d58f66bc8ab5','9dff52d4-7e4e-4f84-a239-5e9c12be7bca');
INSERT INTO version_variants(version_id,variant_id,model_asset_id,texture_asset_id) VALUES (1,'420cd16c-422a-4c1e-ad61-2fdf4c0e9b93','ab7d911c-73e7-4dfd-a57d-d58f66bc8ab5','c10bf070-bbcf-4944-a249-f36c6e952d84');
INSERT INTO version_variants(version_id,variant_id,model_asset_id,texture_asset_id) VALUES (1,'eaee5ce0-19a3-4896-aa78-572d0f3a898b','ab7d911c-73e7-4dfd-a57d-d58f66bc8ab5','7ff95eac-7e18-43dc-a9b3-5e4fabbf790d');
INSERT INTO version_variants(version_id,variant_id,model_asset_id,texture_asset_id) VALUES (1,'04e6f2e4-150d-42dd-ad01-e5e258dd5aea','ab7d911c-73e7-4dfd-a57d-d58f66bc8ab5','6939b4f7-8f18-4c71-a5f8-8014e269aaf3');
INSERT INTO version_variants(version_id,variant_id,model_asset_id,texture_asset_id) VALUES (1,'f3a86157-b735-420e-ab2b-57c78713b64d','ab7d911c-73e7-4dfd-a57d-d58f66bc8ab5','fc491038-a85f-4128-a5fd-73bd5c4d7984');
INSERT INTO version_variants(version_id,variant_id,model_asset_id,texture_asset_id) VALUES (1,'9ed6c02c-e677-4ceb-a361-29a3221a9fa9','ab7d911c-73e7-4dfd-a57d-d58f66bc8ab5','405bd613-c64c-417a-a7f5-86de2c8703fe');
INSERT INTO version_variants(version_id,variant_id,model_asset_id,texture_asset_id) VALUES (1,'22deb74a-1f7c-4823-a98a-35032e276c9d','ab7d911c-73e7-4dfd-a57d-d58f66bc8ab5','647d5385-c3c2-47aa-a5e8-893eaee61de1');
INSERT INTO version_variants(version_id,variant_id,model_asset_id,texture_asset_id) VALUES (1,'265aa5bf-001f-4bcf-aeb4-0e22b1d80252','ab7d911c-73e7-4dfd-a57d-d58f66bc8ab5','e7ca7629-87a7-4aaf-a260-7193156df9e3');
INSERT INTO version_variants(version_id,variant_id,model_asset_id,texture_asset_id) VALUES (1,'5bdf84d0-de33-4dd7-a8d3-09b9182b6ef1','ab7d911c-73e7-4dfd-a57d-d58f66bc8ab5','d084fe9d-35c6-4bc0-ad8e-88ed976b95d9');
INSERT INTO product_storage(product_id,creator_id,index_state,directory_name) VALUES (1,1,'pending','hair-1--p1');
INSERT INTO product_promotions(public_id,product_id,published_at) VALUES ('0e81d84a-9adc-418b-a95a-3eaca8910da1',1,UTC_TIMESTAMP(6));
INSERT INTO productos(id,categoria_id,nombre,descripcion,precio,owner_id,status,model_asset_id,current_version_id,revision) VALUES (2,1,'Hair 2','Academic sample accessory by Shakiara.',2.99,1,'Published','23af5c9b-1ae3-47c4-a827-e4c8f17b242d',2,1);
INSERT INTO assets(id,owner_id,kind,sha256,byte_size,metadata,storage_layout,product_id) VALUES ('67db1563-ead6-404e-ab5d-3513985521ed',1,'png','5f322eda7f94a8175c8574d390cbc0a6eea3617a80937d94836b9f4310ac563d',239760,'{\"width\":1024,\"height\":1024}','product',2);
INSERT INTO product_files(id,product_id,creator_id,kind,sha256,byte_size,storage_version) VALUES (14,2,1,'png','5f322eda7f94a8175c8574d390cbc0a6eea3617a80937d94836b9f4310ac563d',239760,1);
INSERT INTO asset_file_links(asset_id,representation,file_id,product_id) VALUES ('67db1563-ead6-404e-ab5d-3513985521ed','original',14,2);
INSERT INTO asset_file_links(asset_id,representation,file_id,product_id) VALUES ('67db1563-ead6-404e-ab5d-3513985521ed','preview',14,2);
INSERT INTO assets(id,owner_id,kind,sha256,byte_size,metadata,storage_layout,product_id) VALUES ('1590b74b-6fd3-4374-acad-71654b6a0f87',1,'png','068bdce694751c3cfb89410a6c6957b02e99f8ead2d80b9992ccacc4a158aca8',143491,'{\"width\":1024,\"height\":1024}','product',2);
INSERT INTO product_files(id,product_id,creator_id,kind,sha256,byte_size,storage_version) VALUES (15,2,1,'png','068bdce694751c3cfb89410a6c6957b02e99f8ead2d80b9992ccacc4a158aca8',143491,1);
INSERT INTO asset_file_links(asset_id,representation,file_id,product_id) VALUES ('1590b74b-6fd3-4374-acad-71654b6a0f87','original',15,2);
INSERT INTO asset_file_links(asset_id,representation,file_id,product_id) VALUES ('1590b74b-6fd3-4374-acad-71654b6a0f87','preview',15,2);
INSERT INTO assets(id,owner_id,kind,sha256,byte_size,metadata,storage_layout,product_id) VALUES ('3f90bc8f-9cdc-4b93-af2c-0af35eeb78ac',1,'png','5ffda471ffbf27971f7abc83a857b236dc220eff1a8d3676e5c70fffaa16b585',191257,'{\"width\":1024,\"height\":1024}','product',2);
INSERT INTO product_files(id,product_id,creator_id,kind,sha256,byte_size,storage_version) VALUES (16,2,1,'png','5ffda471ffbf27971f7abc83a857b236dc220eff1a8d3676e5c70fffaa16b585',191257,1);
INSERT INTO asset_file_links(asset_id,representation,file_id,product_id) VALUES ('3f90bc8f-9cdc-4b93-af2c-0af35eeb78ac','original',16,2);
INSERT INTO asset_file_links(asset_id,representation,file_id,product_id) VALUES ('3f90bc8f-9cdc-4b93-af2c-0af35eeb78ac','preview',16,2);
INSERT INTO assets(id,owner_id,kind,sha256,byte_size,metadata,storage_layout,product_id) VALUES ('75467f52-31b2-4f36-aeaa-3a9f746e387e',1,'png','3c60801e6f23ed567efb81769091dc059923bd6bedb719ead6107eee41ccfad8',259572,'{\"width\":1024,\"height\":1024}','product',2);
INSERT INTO product_files(id,product_id,creator_id,kind,sha256,byte_size,storage_version) VALUES (17,2,1,'png','3c60801e6f23ed567efb81769091dc059923bd6bedb719ead6107eee41ccfad8',259572,1);
INSERT INTO asset_file_links(asset_id,representation,file_id,product_id) VALUES ('75467f52-31b2-4f36-aeaa-3a9f746e387e','original',17,2);
INSERT INTO asset_file_links(asset_id,representation,file_id,product_id) VALUES ('75467f52-31b2-4f36-aeaa-3a9f746e387e','preview',17,2);
INSERT INTO assets(id,owner_id,kind,sha256,byte_size,metadata,storage_layout,product_id) VALUES ('8ace6a69-d39a-4606-ad2b-936f77f40d9c',1,'png','4f03337ab04d5681eab151ff2c7f062f1ec90d22f42197130c0aff3e68ba0334',247293,'{\"width\":1024,\"height\":1024}','product',2);
INSERT INTO product_files(id,product_id,creator_id,kind,sha256,byte_size,storage_version) VALUES (18,2,1,'png','4f03337ab04d5681eab151ff2c7f062f1ec90d22f42197130c0aff3e68ba0334',247293,1);
INSERT INTO asset_file_links(asset_id,representation,file_id,product_id) VALUES ('8ace6a69-d39a-4606-ad2b-936f77f40d9c','original',18,2);
INSERT INTO asset_file_links(asset_id,representation,file_id,product_id) VALUES ('8ace6a69-d39a-4606-ad2b-936f77f40d9c','preview',18,2);
INSERT INTO assets(id,owner_id,kind,sha256,byte_size,metadata,storage_layout,product_id) VALUES ('b37767e5-6578-49fa-a676-d5ecc0d6c41c',1,'png','c363459c321eb5f96d7929e10f0e1ead7b7fd6434043edc1fb3bf6cfd9840e5a',245797,'{\"width\":1024,\"height\":1024}','product',2);
INSERT INTO product_files(id,product_id,creator_id,kind,sha256,byte_size,storage_version) VALUES (19,2,1,'png','c363459c321eb5f96d7929e10f0e1ead7b7fd6434043edc1fb3bf6cfd9840e5a',245797,1);
INSERT INTO asset_file_links(asset_id,representation,file_id,product_id) VALUES ('b37767e5-6578-49fa-a676-d5ecc0d6c41c','original',19,2);
INSERT INTO asset_file_links(asset_id,representation,file_id,product_id) VALUES ('b37767e5-6578-49fa-a676-d5ecc0d6c41c','preview',19,2);
INSERT INTO assets(id,owner_id,kind,sha256,byte_size,metadata,storage_layout,product_id) VALUES ('ac4d5e82-29ec-4af4-ade3-89903c5f2140',1,'png','cccaa1ae222485bdc0b888388ed02269bfcec8a9bbe001d06151a08e34f67879',237044,'{\"width\":1024,\"height\":1024}','product',2);
INSERT INTO product_files(id,product_id,creator_id,kind,sha256,byte_size,storage_version) VALUES (20,2,1,'png','cccaa1ae222485bdc0b888388ed02269bfcec8a9bbe001d06151a08e34f67879',237044,1);
INSERT INTO asset_file_links(asset_id,representation,file_id,product_id) VALUES ('ac4d5e82-29ec-4af4-ade3-89903c5f2140','original',20,2);
INSERT INTO asset_file_links(asset_id,representation,file_id,product_id) VALUES ('ac4d5e82-29ec-4af4-ade3-89903c5f2140','preview',20,2);
INSERT INTO assets(id,owner_id,kind,sha256,byte_size,metadata,storage_layout,product_id) VALUES ('08257f42-c486-4ed3-a73a-76d8a135cce3',1,'png','4677dc984065853d8630cf8bca413185888e4f41a20866a070dfcecf551be94b',210085,'{\"width\":1024,\"height\":1024}','product',2);
INSERT INTO product_files(id,product_id,creator_id,kind,sha256,byte_size,storage_version) VALUES (21,2,1,'png','4677dc984065853d8630cf8bca413185888e4f41a20866a070dfcecf551be94b',210085,1);
INSERT INTO asset_file_links(asset_id,representation,file_id,product_id) VALUES ('08257f42-c486-4ed3-a73a-76d8a135cce3','original',21,2);
INSERT INTO asset_file_links(asset_id,representation,file_id,product_id) VALUES ('08257f42-c486-4ed3-a73a-76d8a135cce3','preview',21,2);
INSERT INTO assets(id,owner_id,kind,sha256,byte_size,metadata,storage_layout,product_id) VALUES ('f4707c17-fc13-4b22-aa25-905f9b1456c3',1,'png','1e701c7c1ae336b107ceca5c29a219e4a61e611541a1cc4ff3aeba2a3f54dfd0',274586,'{\"width\":1024,\"height\":1024}','product',2);
INSERT INTO product_files(id,product_id,creator_id,kind,sha256,byte_size,storage_version) VALUES (22,2,1,'png','1e701c7c1ae336b107ceca5c29a219e4a61e611541a1cc4ff3aeba2a3f54dfd0',274586,1);
INSERT INTO asset_file_links(asset_id,representation,file_id,product_id) VALUES ('f4707c17-fc13-4b22-aa25-905f9b1456c3','original',22,2);
INSERT INTO asset_file_links(asset_id,representation,file_id,product_id) VALUES ('f4707c17-fc13-4b22-aa25-905f9b1456c3','preview',22,2);
INSERT INTO assets(id,owner_id,kind,sha256,byte_size,metadata,storage_layout,product_id) VALUES ('e743d6f0-5d21-4d3c-a5ca-ccc73e1bbdf0',1,'png','f69e610383947f6362ba9056f15f84f9c8795a09911c397cc1243b898e8fd07f',164611,'{\"width\":1024,\"height\":1024}','product',2);
INSERT INTO product_files(id,product_id,creator_id,kind,sha256,byte_size,storage_version) VALUES (23,2,1,'png','f69e610383947f6362ba9056f15f84f9c8795a09911c397cc1243b898e8fd07f',164611,1);
INSERT INTO asset_file_links(asset_id,representation,file_id,product_id) VALUES ('e743d6f0-5d21-4d3c-a5ca-ccc73e1bbdf0','original',23,2);
INSERT INTO asset_file_links(asset_id,representation,file_id,product_id) VALUES ('e743d6f0-5d21-4d3c-a5ca-ccc73e1bbdf0','preview',23,2);
INSERT INTO assets(id,owner_id,kind,sha256,byte_size,metadata,storage_layout,product_id) VALUES ('f55e0cf7-ae1f-48a7-a47d-95ffa7f3438f',1,'png','4275b4130baf2ee2dcf9f56d8b74a5c59e60f41c31580b710bb5d5f28039002f',176852,'{\"width\":1024,\"height\":1024}','product',2);
INSERT INTO product_files(id,product_id,creator_id,kind,sha256,byte_size,storage_version) VALUES (24,2,1,'png','4275b4130baf2ee2dcf9f56d8b74a5c59e60f41c31580b710bb5d5f28039002f',176852,1);
INSERT INTO asset_file_links(asset_id,representation,file_id,product_id) VALUES ('f55e0cf7-ae1f-48a7-a47d-95ffa7f3438f','original',24,2);
INSERT INTO asset_file_links(asset_id,representation,file_id,product_id) VALUES ('f55e0cf7-ae1f-48a7-a47d-95ffa7f3438f','preview',24,2);
INSERT INTO assets(id,owner_id,kind,sha256,byte_size,metadata,storage_layout,product_id) VALUES ('cb21f56f-67bd-4fc4-a577-a7bd2ad39c41',1,'png','74a1b0b40938b20def9311e5454cb45d2c74151c7395d585631577406fd6ff2d',189440,'{\"width\":1024,\"height\":1024}','product',2);
INSERT INTO product_files(id,product_id,creator_id,kind,sha256,byte_size,storage_version) VALUES (25,2,1,'png','74a1b0b40938b20def9311e5454cb45d2c74151c7395d585631577406fd6ff2d',189440,1);
INSERT INTO asset_file_links(asset_id,representation,file_id,product_id) VALUES ('cb21f56f-67bd-4fc4-a577-a7bd2ad39c41','original',25,2);
INSERT INTO asset_file_links(asset_id,representation,file_id,product_id) VALUES ('cb21f56f-67bd-4fc4-a577-a7bd2ad39c41','preview',25,2);
INSERT INTO assets(id,owner_id,kind,sha256,byte_size,metadata,storage_layout,product_id) VALUES ('10ee1201-23b0-4b02-a2c1-bdaaec30b305',1,'png','de3e518c6dccb52e7d57a58955ac743396c1728beb6a1333a87b1a2af250dda1',339539,'{\"width\":1024,\"height\":1024}','product',2);
INSERT INTO product_files(id,product_id,creator_id,kind,sha256,byte_size,storage_version) VALUES (26,2,1,'png','de3e518c6dccb52e7d57a58955ac743396c1728beb6a1333a87b1a2af250dda1',339539,1);
INSERT INTO asset_file_links(asset_id,representation,file_id,product_id) VALUES ('10ee1201-23b0-4b02-a2c1-bdaaec30b305','original',26,2);
INSERT INTO asset_file_links(asset_id,representation,file_id,product_id) VALUES ('10ee1201-23b0-4b02-a2c1-bdaaec30b305','preview',26,2);
INSERT INTO assets(id,owner_id,kind,sha256,byte_size,metadata,storage_layout,product_id) VALUES ('a72be068-627e-4909-a7d9-3478c93bf8eb',1,'png','0b039fb95155a8b6a0ad28c8bf4f55b753f8af8c171a5e7394cde7034f41f282',211454,'{\"width\":1024,\"height\":1024}','product',2);
INSERT INTO product_files(id,product_id,creator_id,kind,sha256,byte_size,storage_version) VALUES (27,2,1,'png','0b039fb95155a8b6a0ad28c8bf4f55b753f8af8c171a5e7394cde7034f41f282',211454,1);
INSERT INTO asset_file_links(asset_id,representation,file_id,product_id) VALUES ('a72be068-627e-4909-a7d9-3478c93bf8eb','original',27,2);
INSERT INTO asset_file_links(asset_id,representation,file_id,product_id) VALUES ('a72be068-627e-4909-a7d9-3478c93bf8eb','preview',27,2);
INSERT INTO assets(id,owner_id,kind,sha256,byte_size,metadata,storage_layout,product_id) VALUES ('f18fd00e-3293-49af-a2a3-6525a758b9ee',1,'png','f86b74b1ff01d4b257c7bf0ad6f9bf8c8e69572926a53e22c375f4b00ccda271',175348,'{\"width\":1024,\"height\":1024}','product',2);
INSERT INTO product_files(id,product_id,creator_id,kind,sha256,byte_size,storage_version) VALUES (28,2,1,'png','f86b74b1ff01d4b257c7bf0ad6f9bf8c8e69572926a53e22c375f4b00ccda271',175348,1);
INSERT INTO asset_file_links(asset_id,representation,file_id,product_id) VALUES ('f18fd00e-3293-49af-a2a3-6525a758b9ee','original',28,2);
INSERT INTO asset_file_links(asset_id,representation,file_id,product_id) VALUES ('f18fd00e-3293-49af-a2a3-6525a758b9ee','preview',28,2);
INSERT INTO assets(id,owner_id,kind,sha256,byte_size,metadata,storage_layout,product_id) VALUES ('da47faab-5947-4c50-ad2e-eca6c61f1660',1,'png','6577357b90166d61a235a162c763f171f4683de08971b41947ba446def779a14',134011,'{\"width\":1024,\"height\":1024}','product',2);
INSERT INTO product_files(id,product_id,creator_id,kind,sha256,byte_size,storage_version) VALUES (29,2,1,'png','6577357b90166d61a235a162c763f171f4683de08971b41947ba446def779a14',134011,1);
INSERT INTO asset_file_links(asset_id,representation,file_id,product_id) VALUES ('da47faab-5947-4c50-ad2e-eca6c61f1660','original',29,2);
INSERT INTO asset_file_links(asset_id,representation,file_id,product_id) VALUES ('da47faab-5947-4c50-ad2e-eca6c61f1660','preview',29,2);
INSERT INTO assets(id,owner_id,kind,sha256,byte_size,metadata,storage_layout,product_id) VALUES ('1160826f-8b5c-43b4-a9f3-1a0ee753a994',1,'png','f6f53c65abe2717b6c008690ac0d2d03970adb049c9071d52f5d7a2b666bab09',142744,'{\"width\":1024,\"height\":1024}','product',2);
INSERT INTO product_files(id,product_id,creator_id,kind,sha256,byte_size,storage_version) VALUES (30,2,1,'png','f6f53c65abe2717b6c008690ac0d2d03970adb049c9071d52f5d7a2b666bab09',142744,1);
INSERT INTO asset_file_links(asset_id,representation,file_id,product_id) VALUES ('1160826f-8b5c-43b4-a9f3-1a0ee753a994','original',30,2);
INSERT INTO asset_file_links(asset_id,representation,file_id,product_id) VALUES ('1160826f-8b5c-43b4-a9f3-1a0ee753a994','preview',30,2);
INSERT INTO assets(id,owner_id,kind,sha256,byte_size,metadata,storage_layout,product_id) VALUES ('23af5c9b-1ae3-47c4-a827-e4c8f17b242d',1,'glb','cd8329b41387d39d90d0e2aff306054f2d2c2d294483a052cb589e8b1909d646',352640,'{\"compatible\":true,\"materials\":1}','product',2);
INSERT INTO product_files(id,product_id,creator_id,kind,sha256,byte_size,storage_version) VALUES (31,2,1,'glb','cd8329b41387d39d90d0e2aff306054f2d2c2d294483a052cb589e8b1909d646',352640,1);
INSERT INTO asset_file_links(asset_id,representation,file_id,product_id) VALUES ('23af5c9b-1ae3-47c4-a827-e4c8f17b242d','original',31,2);
INSERT INTO asset_file_links(asset_id,representation,file_id,product_id) VALUES ('23af5c9b-1ae3-47c4-a827-e4c8f17b242d','preview',31,2);
INSERT INTO variants(id,product_id,name,hex,texture_asset_id,is_default) VALUES ('d4976116-bf1e-436c-a983-e440213f8cdf',2,'Black Rainbow Png','#1a1917','67db1563-ead6-404e-ab5d-3513985521ed',1);
INSERT INTO variants(id,product_id,name,hex,texture_asset_id,is_default) VALUES ('add59ad3-c119-4efc-a15f-98c4e8e7be3f',2,'Black Whitegrayish Png','#191919','1590b74b-6fd3-4374-acad-71654b6a0f87',0);
INSERT INTO variants(id,product_id,name,hex,texture_asset_id,is_default) VALUES ('d263c232-e06d-4fdf-a2d5-e1fe93d86ea3',2,'Blonde White Png','#3a3835','3f90bc8f-9cdc-4b93-af2c-0af35eeb78ac',0);
INSERT INTO variants(id,product_id,name,hex,texture_asset_id,is_default) VALUES ('8ddfda9f-b2f6-4ed7-a66a-f0195f1ae4ec',2,'Blondel Blonde Png','#2f2a26','75467f52-31b2-4f36-aeaa-3a9f746e387e',0);
INSERT INTO variants(id,product_id,name,hex,texture_asset_id,is_default) VALUES ('4c5dfecc-8eb7-4274-a592-445c4248db6e',2,'Blue Teal Png','#101820','8ace6a69-d39a-4606-ad2b-936f77f40d9c',0);
INSERT INTO variants(id,product_id,name,hex,texture_asset_id,is_default) VALUES ('650cd2a0-fcb4-4ad4-a82d-9519429c8bfa',2,'Brown Blondel Png','#1b1916','b37767e5-6578-49fa-a676-d5ecc0d6c41c',0);
INSERT INTO variants(id,product_id,name,hex,texture_asset_id,is_default) VALUES ('b3cee2b7-f1d0-42ea-a542-d72a1f8e22f9',2,'Brownl Red Png','#1d100f','ac4d5e82-29ec-4af4-ade3-89903c5f2140',0);
INSERT INTO variants(id,product_id,name,hex,texture_asset_id,is_default) VALUES ('6400882d-85e9-4679-a34a-58cc7a36d15c',2,'Cherry Red Png','#170a0b','08257f42-c486-4ed3-a73a-76d8a135cce3',0);
INSERT INTO variants(id,product_id,name,hex,texture_asset_id,is_default) VALUES ('fc2d22ad-7d5d-4845-a264-4574523ba81b',2,'Ginger Brownl Png','#24160f','f4707c17-fc13-4b22-aa25-905f9b1456c3',0);
INSERT INTO variants(id,product_id,name,hex,texture_asset_id,is_default) VALUES ('3e32716d-b6a1-4c3a-ab42-3f39182214e8',2,'Gray White Png','#272728','e743d6f0-5d21-4d3c-a5ca-ccc73e1bbdf0',0);
INSERT INTO variants(id,product_id,name,hex,texture_asset_id,is_default) VALUES ('f1c57166-7026-46f7-a4f1-6810be9e9f81',2,'Magenta White Png','#3d2b3b','f55e0cf7-ae1f-48a7-a47d-95ffa7f3438f',0);
INSERT INTO variants(id,product_id,name,hex,texture_asset_id,is_default) VALUES ('fdcd3281-a158-4371-a690-f23d4f72bef9',2,'Pink White Png','#343232','cb21f56f-67bd-4fc4-a577-a7bd2ad39c41',0);
INSERT INTO variants(id,product_id,name,hex,texture_asset_id,is_default) VALUES ('3dac3be0-db3b-46d7-a789-d42b1a3cbdd0',2,'Rainbow Ginger Png','#2e241c','10ee1201-23b0-4b02-a2c1-bdaaec30b305',0);
INSERT INTO variants(id,product_id,name,hex,texture_asset_id,is_default) VALUES ('bc9bdb16-2b7c-4320-a472-400cb1987102',2,'Red Whitegray Png','#261b1b','a72be068-627e-4909-a7d9-3478c93bf8eb',0);
INSERT INTO variants(id,product_id,name,hex,texture_asset_id,is_default) VALUES ('e40a4a1d-cca4-44a8-aeea-940810e37d03',2,'Teal White Png','#272e2e','f18fd00e-3293-49af-a2a3-6525a758b9ee',0);
INSERT INTO variants(id,product_id,name,hex,texture_asset_id,is_default) VALUES ('5b314149-1b38-4909-a808-d3f809b5dea6',2,'White Whitegray Png','#343434','da47faab-5947-4c50-ad2e-eca6c61f1660',0);
INSERT INTO variants(id,product_id,name,hex,texture_asset_id,is_default) VALUES ('60ba8ddf-5573-4474-afbd-5339a8d97408',2,'Whitegray White Png','#323232','1160826f-8b5c-43b4-a9f3-1a0ee753a994',0);
INSERT INTO product_versions(id,product_id,version_number,snapshot) VALUES (2,2,1,'{\"id\":2,\"owner_id\":1,\"creator_name\":\"Admin\",\"name\":\"Hair 2\",\"description\":\"Academic sample accessory by Shakiara.\",\"category_id\":1,\"category\":\"Hair\",\"price\":2.99,\"model_asset_id\":\"23af5c9b-1ae3-47c4-a827-e4c8f17b242d\",\"model_url\":\"/api/previews/23af5c9b-1ae3-47c4-a827-e4c8f17b242d\",\"status\":\"Published\",\"revision\":1,\"current_version_id\":2,\"version_number\":1,\"trashed_at\":null,\"variants\":[{\"id\":\"d4976116-bf1e-436c-a983-e440213f8cdf\",\"product_id\":2,\"name\":\"Black Rainbow Png\",\"hex\":\"#1a1917\",\"texture_asset_id\":\"67db1563-ead6-404e-ab5d-3513985521ed\",\"texture_url\":\"/api/previews/67db1563-ead6-404e-ab5d-3513985521ed\",\"is_default\":true,\"legacy\":false,\"active\":true},{\"id\":\"add59ad3-c119-4efc-a15f-98c4e8e7be3f\",\"product_id\":2,\"name\":\"Black Whitegrayish Png\",\"hex\":\"#191919\",\"texture_asset_id\":\"1590b74b-6fd3-4374-acad-71654b6a0f87\",\"texture_url\":\"/api/previews/1590b74b-6fd3-4374-acad-71654b6a0f87\",\"is_default\":false,\"legacy\":false,\"active\":true},{\"id\":\"d263c232-e06d-4fdf-a2d5-e1fe93d86ea3\",\"product_id\":2,\"name\":\"Blonde White Png\",\"hex\":\"#3a3835\",\"texture_asset_id\":\"3f90bc8f-9cdc-4b93-af2c-0af35eeb78ac\",\"texture_url\":\"/api/previews/3f90bc8f-9cdc-4b93-af2c-0af35eeb78ac\",\"is_default\":false,\"legacy\":false,\"active\":true},{\"id\":\"8ddfda9f-b2f6-4ed7-a66a-f0195f1ae4ec\",\"product_id\":2,\"name\":\"Blondel Blonde Png\",\"hex\":\"#2f2a26\",\"texture_asset_id\":\"75467f52-31b2-4f36-aeaa-3a9f746e387e\",\"texture_url\":\"/api/previews/75467f52-31b2-4f36-aeaa-3a9f746e387e\",\"is_default\":false,\"legacy\":false,\"active\":true},{\"id\":\"4c5dfecc-8eb7-4274-a592-445c4248db6e\",\"product_id\":2,\"name\":\"Blue Teal Png\",\"hex\":\"#101820\",\"texture_asset_id\":\"8ace6a69-d39a-4606-ad2b-936f77f40d9c\",\"texture_url\":\"/api/previews/8ace6a69-d39a-4606-ad2b-936f77f40d9c\",\"is_default\":false,\"legacy\":false,\"active\":true},{\"id\":\"650cd2a0-fcb4-4ad4-a82d-9519429c8bfa\",\"product_id\":2,\"name\":\"Brown Blondel Png\",\"hex\":\"#1b1916\",\"texture_asset_id\":\"b37767e5-6578-49fa-a676-d5ecc0d6c41c\",\"texture_url\":\"/api/previews/b37767e5-6578-49fa-a676-d5ecc0d6c41c\",\"is_default\":false,\"legacy\":false,\"active\":true},{\"id\":\"b3cee2b7-f1d0-42ea-a542-d72a1f8e22f9\",\"product_id\":2,\"name\":\"Brownl Red Png\",\"hex\":\"#1d100f\",\"texture_asset_id\":\"ac4d5e82-29ec-4af4-ade3-89903c5f2140\",\"texture_url\":\"/api/previews/ac4d5e82-29ec-4af4-ade3-89903c5f2140\",\"is_default\":false,\"legacy\":false,\"active\":true},{\"id\":\"6400882d-85e9-4679-a34a-58cc7a36d15c\",\"product_id\":2,\"name\":\"Cherry Red Png\",\"hex\":\"#170a0b\",\"texture_asset_id\":\"08257f42-c486-4ed3-a73a-76d8a135cce3\",\"texture_url\":\"/api/previews/08257f42-c486-4ed3-a73a-76d8a135cce3\",\"is_default\":false,\"legacy\":false,\"active\":true},{\"id\":\"fc2d22ad-7d5d-4845-a264-4574523ba81b\",\"product_id\":2,\"name\":\"Ginger Brownl Png\",\"hex\":\"#24160f\",\"texture_asset_id\":\"f4707c17-fc13-4b22-aa25-905f9b1456c3\",\"texture_url\":\"/api/previews/f4707c17-fc13-4b22-aa25-905f9b1456c3\",\"is_default\":false,\"legacy\":false,\"active\":true},{\"id\":\"3e32716d-b6a1-4c3a-ab42-3f39182214e8\",\"product_id\":2,\"name\":\"Gray White Png\",\"hex\":\"#272728\",\"texture_asset_id\":\"e743d6f0-5d21-4d3c-a5ca-ccc73e1bbdf0\",\"texture_url\":\"/api/previews/e743d6f0-5d21-4d3c-a5ca-ccc73e1bbdf0\",\"is_default\":false,\"legacy\":false,\"active\":true},{\"id\":\"f1c57166-7026-46f7-a4f1-6810be9e9f81\",\"product_id\":2,\"name\":\"Magenta White Png\",\"hex\":\"#3d2b3b\",\"texture_asset_id\":\"f55e0cf7-ae1f-48a7-a47d-95ffa7f3438f\",\"texture_url\":\"/api/previews/f55e0cf7-ae1f-48a7-a47d-95ffa7f3438f\",\"is_default\":false,\"legacy\":false,\"active\":true},{\"id\":\"fdcd3281-a158-4371-a690-f23d4f72bef9\",\"product_id\":2,\"name\":\"Pink White Png\",\"hex\":\"#343232\",\"texture_asset_id\":\"cb21f56f-67bd-4fc4-a577-a7bd2ad39c41\",\"texture_url\":\"/api/previews/cb21f56f-67bd-4fc4-a577-a7bd2ad39c41\",\"is_default\":false,\"legacy\":false,\"active\":true},{\"id\":\"3dac3be0-db3b-46d7-a789-d42b1a3cbdd0\",\"product_id\":2,\"name\":\"Rainbow Ginger Png\",\"hex\":\"#2e241c\",\"texture_asset_id\":\"10ee1201-23b0-4b02-a2c1-bdaaec30b305\",\"texture_url\":\"/api/previews/10ee1201-23b0-4b02-a2c1-bdaaec30b305\",\"is_default\":false,\"legacy\":false,\"active\":true},{\"id\":\"bc9bdb16-2b7c-4320-a472-400cb1987102\",\"product_id\":2,\"name\":\"Red Whitegray Png\",\"hex\":\"#261b1b\",\"texture_asset_id\":\"a72be068-627e-4909-a7d9-3478c93bf8eb\",\"texture_url\":\"/api/previews/a72be068-627e-4909-a7d9-3478c93bf8eb\",\"is_default\":false,\"legacy\":false,\"active\":true},{\"id\":\"e40a4a1d-cca4-44a8-aeea-940810e37d03\",\"product_id\":2,\"name\":\"Teal White Png\",\"hex\":\"#272e2e\",\"texture_asset_id\":\"f18fd00e-3293-49af-a2a3-6525a758b9ee\",\"texture_url\":\"/api/previews/f18fd00e-3293-49af-a2a3-6525a758b9ee\",\"is_default\":false,\"legacy\":false,\"active\":true},{\"id\":\"5b314149-1b38-4909-a808-d3f809b5dea6\",\"product_id\":2,\"name\":\"White Whitegray Png\",\"hex\":\"#343434\",\"texture_asset_id\":\"da47faab-5947-4c50-ad2e-eca6c61f1660\",\"texture_url\":\"/api/previews/da47faab-5947-4c50-ad2e-eca6c61f1660\",\"is_default\":false,\"legacy\":false,\"active\":true},{\"id\":\"60ba8ddf-5573-4474-afbd-5339a8d97408\",\"product_id\":2,\"name\":\"Whitegray White Png\",\"hex\":\"#323232\",\"texture_asset_id\":\"1160826f-8b5c-43b4-a9f3-1a0ee753a994\",\"texture_url\":\"/api/previews/1160826f-8b5c-43b4-a9f3-1a0ee753a994\",\"is_default\":false,\"legacy\":false,\"active\":true}]}');
INSERT INTO version_variants(version_id,variant_id,model_asset_id,texture_asset_id) VALUES (2,'d4976116-bf1e-436c-a983-e440213f8cdf','23af5c9b-1ae3-47c4-a827-e4c8f17b242d','67db1563-ead6-404e-ab5d-3513985521ed');
INSERT INTO version_variants(version_id,variant_id,model_asset_id,texture_asset_id) VALUES (2,'add59ad3-c119-4efc-a15f-98c4e8e7be3f','23af5c9b-1ae3-47c4-a827-e4c8f17b242d','1590b74b-6fd3-4374-acad-71654b6a0f87');
INSERT INTO version_variants(version_id,variant_id,model_asset_id,texture_asset_id) VALUES (2,'d263c232-e06d-4fdf-a2d5-e1fe93d86ea3','23af5c9b-1ae3-47c4-a827-e4c8f17b242d','3f90bc8f-9cdc-4b93-af2c-0af35eeb78ac');
INSERT INTO version_variants(version_id,variant_id,model_asset_id,texture_asset_id) VALUES (2,'8ddfda9f-b2f6-4ed7-a66a-f0195f1ae4ec','23af5c9b-1ae3-47c4-a827-e4c8f17b242d','75467f52-31b2-4f36-aeaa-3a9f746e387e');
INSERT INTO version_variants(version_id,variant_id,model_asset_id,texture_asset_id) VALUES (2,'4c5dfecc-8eb7-4274-a592-445c4248db6e','23af5c9b-1ae3-47c4-a827-e4c8f17b242d','8ace6a69-d39a-4606-ad2b-936f77f40d9c');
INSERT INTO version_variants(version_id,variant_id,model_asset_id,texture_asset_id) VALUES (2,'650cd2a0-fcb4-4ad4-a82d-9519429c8bfa','23af5c9b-1ae3-47c4-a827-e4c8f17b242d','b37767e5-6578-49fa-a676-d5ecc0d6c41c');
INSERT INTO version_variants(version_id,variant_id,model_asset_id,texture_asset_id) VALUES (2,'b3cee2b7-f1d0-42ea-a542-d72a1f8e22f9','23af5c9b-1ae3-47c4-a827-e4c8f17b242d','ac4d5e82-29ec-4af4-ade3-89903c5f2140');
INSERT INTO version_variants(version_id,variant_id,model_asset_id,texture_asset_id) VALUES (2,'6400882d-85e9-4679-a34a-58cc7a36d15c','23af5c9b-1ae3-47c4-a827-e4c8f17b242d','08257f42-c486-4ed3-a73a-76d8a135cce3');
INSERT INTO version_variants(version_id,variant_id,model_asset_id,texture_asset_id) VALUES (2,'fc2d22ad-7d5d-4845-a264-4574523ba81b','23af5c9b-1ae3-47c4-a827-e4c8f17b242d','f4707c17-fc13-4b22-aa25-905f9b1456c3');
INSERT INTO version_variants(version_id,variant_id,model_asset_id,texture_asset_id) VALUES (2,'3e32716d-b6a1-4c3a-ab42-3f39182214e8','23af5c9b-1ae3-47c4-a827-e4c8f17b242d','e743d6f0-5d21-4d3c-a5ca-ccc73e1bbdf0');
INSERT INTO version_variants(version_id,variant_id,model_asset_id,texture_asset_id) VALUES (2,'f1c57166-7026-46f7-a4f1-6810be9e9f81','23af5c9b-1ae3-47c4-a827-e4c8f17b242d','f55e0cf7-ae1f-48a7-a47d-95ffa7f3438f');
INSERT INTO version_variants(version_id,variant_id,model_asset_id,texture_asset_id) VALUES (2,'fdcd3281-a158-4371-a690-f23d4f72bef9','23af5c9b-1ae3-47c4-a827-e4c8f17b242d','cb21f56f-67bd-4fc4-a577-a7bd2ad39c41');
INSERT INTO version_variants(version_id,variant_id,model_asset_id,texture_asset_id) VALUES (2,'3dac3be0-db3b-46d7-a789-d42b1a3cbdd0','23af5c9b-1ae3-47c4-a827-e4c8f17b242d','10ee1201-23b0-4b02-a2c1-bdaaec30b305');
INSERT INTO version_variants(version_id,variant_id,model_asset_id,texture_asset_id) VALUES (2,'bc9bdb16-2b7c-4320-a472-400cb1987102','23af5c9b-1ae3-47c4-a827-e4c8f17b242d','a72be068-627e-4909-a7d9-3478c93bf8eb');
INSERT INTO version_variants(version_id,variant_id,model_asset_id,texture_asset_id) VALUES (2,'e40a4a1d-cca4-44a8-aeea-940810e37d03','23af5c9b-1ae3-47c4-a827-e4c8f17b242d','f18fd00e-3293-49af-a2a3-6525a758b9ee');
INSERT INTO version_variants(version_id,variant_id,model_asset_id,texture_asset_id) VALUES (2,'5b314149-1b38-4909-a808-d3f809b5dea6','23af5c9b-1ae3-47c4-a827-e4c8f17b242d','da47faab-5947-4c50-ad2e-eca6c61f1660');
INSERT INTO version_variants(version_id,variant_id,model_asset_id,texture_asset_id) VALUES (2,'60ba8ddf-5573-4474-afbd-5339a8d97408','23af5c9b-1ae3-47c4-a827-e4c8f17b242d','1160826f-8b5c-43b4-a9f3-1a0ee753a994');
INSERT INTO product_storage(product_id,creator_id,index_state,directory_name) VALUES (2,1,'pending','hair-2--p2');
INSERT INTO product_promotions(public_id,product_id,published_at) VALUES ('8e9cf33e-4e25-45c4-ab11-347b8c6ff44b',2,UTC_TIMESTAMP(6));
INSERT INTO schema_migrations(id) VALUES ('002_auth'),('003_products'),('004_history'),('005_storage_resolution'),('006_product_storage'),('007_legacy_storage'),('008_storage_cleanup'),('009_legacy_retirement'),('010_storage_retention'),('011_profiles'),('012_account_settings'),('013_session_metadata'),('014_user_blocks'),('015_account_activity'),('016_conversation_posts'),('017_conversation_engagement'),('018_conversation_moderation'),('019_creator_verification'),('020_admin_foundation'),('021_admin_governance'),('022_admin_refinements'),('023_variant_favorites'),('024_social_lists'),('025_catalog_filters'),('026_permanent_identity'),('027_creator_storage'),('028_product_storage_quotas'),('029_verified_quota_bag'),('030_storage_policy_lifecycle'),('031_following_feed'),('032_acquisition_foundation'),('033_checkout_service'),('034_sales_insights'),('035_review_actions'),('036_my_collection'),('037_readable_product_storage'),('academic_seed_v1');
COMMIT;
SET FOREIGN_KEY_CHECKS=@altego_fk_checks;

DELIMITER $$
CREATE TRIGGER users_username_permanent BEFORE UPDATE ON users FOR EACH ROW BEGIN IF BINARY NEW.username<>BINARY OLD.username THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Username is permanent.'; END IF; END$$
CREATE TRIGGER users_username_lowercase BEFORE INSERT ON users FOR EACH ROW SET NEW.username=LOWER(NEW.username)$$
CREATE TRIGGER sales_attribution_immutable BEFORE UPDATE ON order_items FOR EACH ROW BEGIN
 IF (OLD.creator_id IS NOT NULL AND NOT (NEW.creator_id <=> OLD.creator_id)) OR (OLD.acquired_version_number IS NOT NULL AND NOT (NEW.acquired_version_number <=> OLD.acquired_version_number)) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Historical sales attribution is immutable'; END IF; END$$
DELIMITER ;
