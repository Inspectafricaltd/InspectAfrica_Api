<?php
/**
 * User Roles Management
 *
 * @package InspectAfrica_Bridge
 */

if (!defined('ABSPATH')) {
    exit;
}

class IAB_Roles {

    /**
     * Role slugs
     */
    const CANDIDATE  = 'achi_candidate';
    const CERTIFIED  = 'achi_certified';
    const SUSPENDED  = 'achi_suspended';

    /**
     * Register all ACHI roles. Safe to call multiple times (won't duplicate).
     */
    public static function register(): void {
        // Candidate — enrolled learner, can access LMS course content
        if (!get_role(self::CANDIDATE)) {
            add_role(self::CANDIDATE, 'ACHI Candidate', [
                'read'              => true,
                'learn_lp_content'  => true,  // LearnPress: access course content
            ]);
        }

        // Certified — passed the ACHI course, holds an active certificate
        if (!get_role(self::CERTIFIED)) {
            add_role(self::CERTIFIED, 'ACHI Certified', [
                'read'                    => true,
                'learn_lp_content'        => true,
                'view_achi_certificate'   => true,  // custom cap for cert download/view
            ]);
        }

        // Suspended — certification suspended; can log in but cannot access course or cert
        if (!get_role(self::SUSPENDED)) {
            add_role(self::SUSPENDED, 'ACHI Suspended', [
                'read' => true,
            ]);
        }
    }

    /**
     * Remove all ACHI roles. Called on plugin uninstall only.
     */
    public static function remove(): void {
        remove_role(self::CANDIDATE);
        remove_role(self::CERTIFIED);
        remove_role(self::SUSPENDED);
    }

    /**
     * Assign a role to a user, removing conflicting ACHI roles first.
     */
    public static function assign(int $user_id, string $role): void {
        $user = get_user_by('id', $user_id);
        if (!$user) {
            return;
        }

        // Strip existing ACHI roles before assigning new one
        foreach ([self::CANDIDATE, self::CERTIFIED, self::SUSPENDED] as $achi_role) {
            $user->remove_role($achi_role);
        }

        $user->add_role($role);
    }

    /**
     * Promote a user to Certified (called by LMS hook on ACHI issuance).
     */
    public static function promote_to_certified(int $user_id): void {
        self::assign($user_id, self::CERTIFIED);
    }

    /**
     * Downgrade a user to Candidate (e.g. cert expired or revoked).
     */
    public static function demote_to_candidate(int $user_id): void {
        self::assign($user_id, self::CANDIDATE);
    }

    /**
     * Suspend a user's certification access.
     */
    public static function suspend(int $user_id): void {
        self::assign($user_id, self::SUSPENDED);
    }

    /**
     * Get the primary ACHI role for a user, or null if none assigned.
     */
    public static function get_achi_role(int $user_id): ?string {
        $user = get_user_by('id', $user_id);
        if (!$user) {
            return null;
        }

        $achi_roles = [self::CANDIDATE, self::CERTIFIED, self::SUSPENDED];
        foreach ($achi_roles as $role) {
            if (in_array($role, $user->roles, true)) {
                return $role;
            }
        }

        return null;
    }
}
