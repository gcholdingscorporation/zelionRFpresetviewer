/*
 * Page layouts transcribed from the Rotorflight Configurator 2.3.
 *
 * The viewer's own grouping was an invention, and it showed: settings sat in
 * the wrong boxes, array settings appeared as one comma-joined row where the
 * Configurator splits them per axis, and labels were derived rather than real.
 *
 * This file records what the Configurator actually renders - the boxes in
 * order, the rows in each box in order, which rows are children of a toggle,
 * and the label and unit for each - taken from its src/tabs/*.html. `cli` is
 * the CLI setting a control reads, and `idx` picks one element out of an array
 * setting, which is how the Configurator addresses per-axis values.
 *
 * A row whose CLI setting is absent from the loaded firmware's metadata is
 * skipped at render time, so one layout serves several firmware versions.
 *
 * The Configurator is GPL-3.0; see LICENSE and NOTICE.
 */

window.RF_LAYOUT = {
    profiles: {
        scope: 'profile',

        /* The Configurator's gain matrix has five terms. The offset gains are
         * not in it; they appear as "HSI Offset Gain" rows further down. */
        matrix: {
            title: 'PID Controller Gains',
            axes: ['ROLL', 'PITCH', 'YAW'],
            terms: [
                { key: 'p', head: 'Proportional' },
                { key: 'i', head: 'Integral' },
                { key: 'd', head: 'Derivative' },
                { key: 'f', head: 'Feedforward' },
                { key: 'b', head: 'Boost' }
            ]
        },

        boxes: [
            { title: 'PID Controller Settings', rows: [
                { cli: 'error_rotation', label: 'Piro Compensation' },
                { group: 'Ground Error Decay', on: 'error_decay_time_ground', rows: [
                    { cli: 'error_decay_time_ground', label: 'Decay Time', unit: 's' }
                ] },
                { group: 'I-Term Relax', on: 'iterm_relax_type', rows: [
                    { cli: 'iterm_relax_type', label: 'I-term Relax Type' },
                    { cli: 'iterm_relax_cutoff', idx: 0, label: 'Cutoff Point for Roll' },
                    { cli: 'iterm_relax_cutoff', idx: 1, label: 'Cutoff Point for Pitch' },
                    { cli: 'iterm_relax_cutoff', idx: 2, label: 'Cutoff Point for Yaw' }
                ] },
                { cli: 'error_limit', idx: 0, label: 'Error Limit for Roll Axis', unit: '°' },
                { cli: 'error_limit', idx: 1, label: 'Error Limit for Pitch Axis', unit: '°' },
                { cli: 'error_limit', idx: 2, label: 'Error Limit for Yaw Axis', unit: '°' },
                { cli: 'offset_limit', idx: 0, label: 'HSI Offset Limit for Roll Axis', unit: '°' },
                { cli: 'offset_limit', idx: 1, label: 'HSI Offset Limit for Pitch Axis', unit: '°' },
                { cli: 'roll_o_gain', label: 'HSI Offset Gain for Roll Axis' },
                { cli: 'pitch_o_gain', label: 'HSI Offset Gain for Pitch Axis' }
            ] },

            { title: 'Main Rotor Settings', rows: [
                { group: 'Collective to Pitch Compensation', on: 'pitch_collective_ff_gain', rows: [
                    { cli: 'pitch_collective_ff_gain', label: 'Compensation Gain' }
                ] },
                { group: 'Cyclic Cross-Coupling', on: 'cyclic_cross_coupling_gain', rows: [
                    { cli: 'cyclic_cross_coupling_gain', label: 'Cross-Coupling Gain' },
                    { cli: 'cyclic_cross_coupling_ratio', label: 'Cross-Coupling Ratio', unit: '%' },
                    { cli: 'cyclic_cross_coupling_cutoff', label: 'Cross-Coupling Cutoff Frequency', unit: 'Hz' }
                ] },
                { cli: 'error_decay_time_cyclic', label: 'Error Decay time', unit: 's' },
                { cli: 'error_decay_limit_cyclic', label: 'Error Decay maximum rate', unit: '°/s' }
            ] },

            { title: 'Tail Rotor Settings', rows: [
                { cli: 'yaw_cw_stop_gain', label: 'CW Yaw Stop Gain' },
                { cli: 'yaw_ccw_stop_gain', label: 'CCW Yaw Stop Gain' },
                { cli: 'yaw_precomp_cutoff', label: 'Yaw Precomp Cutoff', unit: 'Hz' },
                { cli: 'yaw_cyclic_ff_gain', label: 'Cyclic Feedforward Gain' },
                { cli: 'yaw_collective_ff_gain', label: 'Collective Feedforward Gain' },
                { cli: 'yaw_inertia_precomp_gain', label: 'Inertia Precomp Gain' },
                { cli: 'yaw_inertia_precomp_cutoff', label: 'Inertia Precomp Cutoff', unit: 'Hz' },
                { cli: 'error_decay_time_yaw', label: 'Error Decay time', unit: 's' },
                { cli: 'error_decay_limit_yaw', label: 'Error Decay maximum rate', unit: '°/s' },
                { cli: 'gov_tta_gain', label: 'Tail Torque Assist (TTA) gain' },
                { cli: 'gov_tta_limit', label: 'Tail Torque Assist (TTA) limit', unit: '%' }
            ] },

            { title: 'PID Controller Bandwidth', rows: [
                { cli: 'roll_gyro_cutoff', label: 'Roll Bandwidth' },
                { cli: 'pitch_gyro_cutoff', label: 'Pitch Bandwidth' },
                { cli: 'yaw_gyro_cutoff', label: 'Yaw Bandwidth' },
                { cli: 'roll_d_cutoff', label: 'Roll D-term Cutoff' },
                { cli: 'pitch_d_cutoff', label: 'Pitch D-term Cutoff' },
                { cli: 'yaw_d_cutoff', label: 'Yaw D-term Cutoff' },
                { cli: 'roll_b_cutoff', label: 'Roll B-term Cutoff' },
                { cli: 'pitch_b_cutoff', label: 'Pitch B-term Cutoff' },
                { cli: 'yaw_b_cutoff', label: 'Yaw B-term Cutoff' }
            ] },

            { title: 'Auto-leveling Settings', rows: [
                { cli: 'acro_trainer_gain', label: 'Acro Trainer gain' },
                { cli: 'acro_trainer_angle_limit', label: 'Acro Trainer angle limit' },
                { cli: 'angle_level_strength', label: 'Angle Mode leveling gain' },
                { cli: 'angle_level_limit', label: 'Angle Mode maximum angle' },
                { cli: 'horizon_level_strength', label: 'Horizon Mode leveling gain' }
            ] },

            { title: 'Rescue Settings', rows: [
                { group: 'Enable Rescue', on: 'rescue_mode', rows: [
                    { cli: 'rescue_flip', label: 'Flip to upright' },
                    { cli: 'rescue_pull_up_collective', label: 'Pull-up Collective', unit: '%' },
                    { cli: 'rescue_pull_up_time', label: 'Pull-up Time', unit: 's' },
                    { cli: 'rescue_climb_collective', label: 'Climb Collective', unit: '%' },
                    { cli: 'rescue_climb_time', label: 'Climb Time', unit: 's' },
                    { cli: 'rescue_hover_collective', label: 'Hover Collective', unit: '%' },
                    { cli: 'rescue_flip_time', label: 'Flip Fail Time', unit: 's' },
                    { cli: 'rescue_exit_time', label: 'Exit Time', unit: 's' },
                    { cli: 'rescue_level_gain', label: 'Leveling Gain' },
                    { cli: 'rescue_flip_gain', label: 'Flip-to-Upright Gain' },
                    { cli: 'rescue_max_sp_rate', label: 'Max Levelling Rate', unit: '°/s' },
                    { cli: 'rescue_max_sp_accel', label: 'Max Leveling Acceleration', unit: '°/s²' }
                ] },
                { group: 'Enable Altitude Hold', on: 'rescue_hover_altitude', rows: [
                    { cli: 'rescue_hover_altitude', label: 'Hover Altitude', unit: 'm' },
                    { cli: 'rescue_alt_p_gain', label: 'Altitude P-Gain' },
                    { cli: 'rescue_alt_i_gain', label: 'Altitude I-Gain' },
                    { cli: 'rescue_alt_d_gain', label: 'Altitude D-Gain' }
                ] },
                { cli: 'rescue_max_collective', label: 'Maximum Collective', unit: '%' }
            ] },

            /* The Configurator renders this box from a Svelte component in its
             * newer style, with sub-headings; the settings and their order are
             * from src/tabs/profiles/Governor.svelte. */
            { title: 'Governor Settings', rows: [
                { cli: 'gov_headspeed', label: 'Full Headspeed', unit: 'rpm' },
                { cli: 'gov_min_throttle', label: 'Minimum Throttle', unit: '%' },
                { cli: 'gov_max_throttle', label: 'Maximum Throttle', unit: '%' },
                { cli: 'gov_fallback_drop', label: 'Throttle Fallback Drop', unit: '%' },
                { sub: 'PID' },
                { cli: 'gov_gain', label: 'Master Gain' },
                { cli: 'gov_p_gain', label: 'P-gain' },
                { cli: 'gov_i_gain', label: 'I-gain' },
                { cli: 'gov_d_gain', label: 'D-gain' },
                { cli: 'gov_f_gain', label: 'Feedforward Gain' },
                { sub: 'Precompensation' },
                { cli: 'gov_collective_ff_weight', label: 'Collective' },
                { cli: 'gov_cyclic_ff_weight', label: 'Cyclic' },
                { cli: 'gov_yaw_ff_weight', label: 'Yaw' },
                { sub: 'Behaviour' },
                { cli: 'gov_use_fallback_precomp', label: 'Fallback Precompensation' },
                { cli: 'gov_use_pid_spoolup', label: 'Governed Spoolup' },
                { cli: 'gov_use_voltage_comp', label: 'Voltage Compensation' },
                { cli: 'gov_use_dyn_min_throttle', label: 'Dynamic Minimum Throttle' }
            ] }
        ]
    }
};
