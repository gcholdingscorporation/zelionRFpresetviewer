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

    /* The Governor tab, from src/tabs/governor/*.svelte.
     *
     * This page is master-only. The per-profile governor gains the viewer used
     * to repeat here belong on the Profiles tab, which is where the
     * Configurator puts them, and where its own note on this page points.
     *
     * Two firmware generations share the page and differ in more than scaling:
     * 4.6 moved the throttle settings into their own sub-section and dropped
     * the signal timeouts, so rows carry `ver`.
     */
    governor: {
        boxes: [
            { title: 'General', rows: [
                { note: 'The Governor has both global and profile parameters. ' +
                        'See the Profiles tab for profile specific parameters.' },
                { cli: 'gov_mode', label: 'Governor Mode' },
                { cli: 'gov_zero_throttle_timeout', label: 'Throttle Signal Timeout', unit: 's', ver: '<4.6' },
                { cli: 'gov_lost_headspeed_timeout', label: 'Headspeed Signal Timeout', unit: 's', ver: '<4.6' },
                { cli: 'gov_handover_throttle', label: 'Handover Throttle', unit: '%', ver: '<4.6' },
                { cli: 'gov_spoolup_min_throttle', label: 'Spoolup Minimum Throttle', unit: '%', ver: '<4.6' },
                { cli: 'gov_autorotation_timeout', label: 'Autorotation Timeout', unit: 's' },
                { cli: 'gov_autorotation_min_entry_time', label: 'Autorotation Minimum Flight Time',
                  unit: 's', ver: '<4.6' },
                { cli: 'gov_throttle_hold_timeout', label: 'Throttle Hold Timeout', unit: 's', ver: '>=4.6' },
                { sub: 'Throttle', ver: '>=4.6' },
                { cli: 'gov_throttle_type', label: 'Throttle Type', ver: '>=4.6' },
                { cli: 'gov_idle_throttle', label: 'Idle Throttle', unit: '%', ver: '>=4.6' },
                { cli: 'gov_auto_throttle', label: 'Auto Throttle', unit: '%', ver: '>=4.6' },
                { cli: 'gov_handover_throttle', label: 'Handover Throttle', unit: '%', ver: '>=4.6' }
            ] },

            /* Ramps.svelte prints the equivalent rate beside each time as
             * 100 / seconds, but only from 4.6. */
            { title: 'Motor Ramp', rows: [
                { cli: 'gov_startup_time', label: 'Startup Time', unit: 's', rate: '>=4.6' },
                { cli: 'gov_spoolup_time', label: 'Spoolup Time', unit: 's', rate: '>=4.6' },
                { cli: 'gov_spooldown_time', label: 'Spooldown Time', unit: 's', rate: '>=4.6' },
                { cli: 'gov_tracking_time', label: 'Tracking Time', unit: 's', rate: '>=4.6' },
                { cli: 'gov_recovery_time', label: 'Recovery Time', unit: 's', rate: '>=4.6' },
                { cli: 'gov_autorotation_bailout_time', label: 'Bailout Time', unit: 's', ver: '<4.6' }
            ] },

            /* ThrottleCurve.svelte stores nine points at twice their percentage
             * and collapses them to five for display when every odd point is
             * the average of its neighbours. */
            { title: 'Governor Bypass Throttle Curve', curve: 'gov_bypass_throttle', rows: [] },

            { title: 'Filters', rows: [
                { cli: 'gov_rpm_filter', label: 'Headspeed Filter Cutoff', unit: 'Hz' },
                { cli: 'gov_pwr_filter', label: 'Battery Voltage Filter Cutoff', unit: 'Hz' },
                { cli: 'gov_tta_filter', label: 'TTA Bandwidth', unit: 'Hz' },
                { cli: 'gov_ff_filter', label: 'Precomp Bandwidth', unit: 'Hz' },
                { cli: 'gov_d_filter', label: 'D-Term Cutoff', unit: 'Hz', ver: '>=4.6' }
            ] }
        ]
    },

    /* The Mixer tab, from src/tabs/mixer.html and src/js/tabs/mixer.js.
     *
     * Most of this page is not a setting. The Configurator derives it from the
     * four stabilised `mixer input` lines and the mixer config, and the same
     * stored number reaches the screen differently depending on the tail type:
     * tail_center_trim is shown as degrees (x24/1000) for a variable-pitch
     * tail and as a percentage (x0.1) for a motorised one. Rows marked `calc`
     * name a function in app.js that does what mixer.js does, and `from` says
     * which line of the file it read, so nothing here is a bare number with no
     * stated origin.
     */
    mixer: {
        boxes: [
            { title: 'Main Rotor Settings', rows: [
                { cli: 'swash_type', label: 'Swashplate Type', enum: 'js:swashTypes' },
                { cli: 'main_rotor_dir', label: 'Main Rotor Direction', enum: 'mixerMainRotorDirection' },
                { calc: 'aileronDirection', label: 'Aileron Control Direction',
                  enum: 'mixerAileronDirection', from: 'mixer input SR' },
                { calc: 'elevatorDirection', label: 'Elevator Control Direction',
                  enum: 'mixerElevatorDirection', from: 'mixer input SP' },
                { calc: 'collectiveDirection', label: 'Collective Control Direction',
                  enum: 'mixerCollectiveDirection', from: 'mixer input SC' }
            ] },

            { title: 'Main Rotor Geometry', rows: [
                { calc: 'cyclicCalibration', label: 'Cyclic calibration', unit: '%', from: 'mixer input SR' },
                { calc: 'collectiveCalibration', label: 'Collective calibration', unit: '%', from: 'mixer input SC' },
                { calc: 'collectiveGeoCorrection', label: 'Collective Geometry Correction', unit: '%',
                  from: 'swash_geo_correction' },
                { calc: 'cyclicLimit', label: 'Cyclic blade pitch limit', unit: '°', from: 'mixer input SP' },
                { calc: 'collectiveLimit', label: 'Collective blade pitch limit', unit: '°', from: 'mixer input SC' },
                { calc: 'totalPitchLimit', label: 'Total blade pitch limit', unit: '°', from: 'swash_pitch_limit' },
                { calc: 'swashPhase', label: 'Swashplate phase angle', unit: '°', from: 'swash_phase' },
                { cli: 'collective_tilt_correction_pos', label: 'Positive Collective Tilt Correction' },
                { cli: 'collective_tilt_correction_neg', label: 'Negative Collective Tilt Correction' }
            ] },

            { title: 'Swashplate Trims', rows: [
                { calc: 'swashRollTrim', label: 'Roll trim', unit: '%', from: 'swash_roll_trim' },
                { calc: 'swashPitchTrim', label: 'Pitch trim', unit: '%', from: 'swash_pitch_trim' },
                { calc: 'swashCollectiveTrim', label: 'Collective trim', unit: '%', from: 'swash_collective_trim' }
            ] },

            { title: 'Tail Rotor Settings', rows: [
                { cli: 'tail_rotor_mode', label: 'Tail rotor type', enum: 'mixerTailRotorMode' },
                { calc: 'tailRotorDirection', label: 'Yaw Control Direction',
                  enum: 'mixerTailRotorDirection', from: 'mixer input SY' },
                { calc: 'tailRotorCenterTrim', label: 'Yaw center trim',
                  when: 'variableTail', from: 'tail_center_trim' },
                { calc: 'tailMotorCenterTrim', label: 'Yaw center offset', unit: '%',
                  when: 'motorisedTail', from: 'tail_center_trim' },
                { calc: 'tailRotorCalibration', label: 'Yaw calibration', unit: '%', from: 'mixer input SY' },
                { calc: 'tailRotorMinYaw', label: 'CW Yaw Blade Angle Limit',
                  when: 'variableTail', from: 'mixer input SY' },
                { calc: 'tailRotorMaxYaw', label: 'CCW Yaw Blade Angle Limit',
                  when: 'variableTail', from: 'mixer input SY' },
                { calc: 'tailMotorMinYaw', label: 'CW yaw limit', unit: '%',
                  when: 'motorisedTail', from: 'mixer input SY' },
                { calc: 'tailMotorMaxYaw', label: 'CCW yaw limit', unit: '%',
                  when: 'motorisedTail', from: 'mixer input SY' },
                { cli: 'tail_motor_idle', label: 'Motor idle throttle', unit: '%', when: 'motorisedTail' }
            ] }
        ]
    },
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

/* Firmware defaults for the stabilised mixer inputs, from rotorflight-firmware
 * src/main/pg/mixer.c pgResetFn_mixerInputs(). A `diff all` only carries the
 * lines that changed, so without these the Mixer tab would be blank for the
 * ones that did not. */
window.RF_MIXER_INPUT_DEFAULTS = {
    SR: { min: -1250, max: 1250, rate: 250 },
    SP: { min: -1250, max: 1250, rate: 250 },
    SY: { min: -1250, max: 1250, rate: 250 },
    SC: { min: -1250, max: 1250, rate: 250 },
    ST: { min: 0, max: 1000, rate: 1000 }
};
