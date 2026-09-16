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

    /* The Configuration tab, from src/tabs/configuration.html and
     * src/js/tabs/configuration.js.
     *
     * Two things on this page cannot come out of a file at all. The gyro update
     * frequency is the board's own sample rate, reported over MSP, and the PID
     * loop frequency is that rate divided by pid_process_denom - so the viewer
     * shows the divisor and says what it divides. The serial port names
     * (S.BUS, TELEM, Int.Rx) come from the target definition, not the file, so
     * the Ports tab lists them by UART number instead.
     */
    configuration: {
        boxes: [
            { title: 'Personalization', rows: [
                { cli: 'name', label: 'Craft name' },
                { cli: 'model_id', label: 'Model Id' }
            ] },

            { title: 'Flight Statistics', rows: [
                { toggle: 'flightStats', label: 'Record Flight Statistics' },
                { cli: 'stats_min_armed_time_s', label: 'Minimum flight time', unit: 's',
                  when: 'flightStats' },
                { cli: 'stats_total_flights', label: 'Flight Count' },
                { calc: 'flightTime', label: 'Flight Time', from: 'stats_total_time_s' },
                { cli: 'stats_total_dist_m', label: 'Distance', unit: 'm' }
            ] },

            { title: 'System configuration', rows: [
                { cli: 'pid_process_denom', label: 'PID loop frequency' },
                { toggle: 'accelerometer', label: 'Accelerometer' },
                { toggle: 'barometer', label: 'Barometer' },
                { toggle: 'magnetometer', label: 'Magnetometer' }
            ] },

            /* Features.GROUPS.OTHER in src/js/features.svelte.js. */
            { title: 'Features', rows: [
                { feature: 'GPS', label: 'GPS', desc: 'GPS for telemetry' },
                { feature: 'LED_STRIP', label: 'LED_STRIP', desc: 'RGB LED Strip support' },
                { feature: 'CMS', label: 'CMS', desc: 'Configuration Menu System' }
            ] },

            { title: 'Board and Sensor Alignment', rows: [
                { cli: 'align_board_roll', label: 'Roll Degrees' },
                { cli: 'align_board_pitch', label: 'Pitch Degrees' },
                { cli: 'align_board_yaw', label: 'Yaw Degrees' },
                { cli: 'align_mag', label: 'MAG Alignment' }
            ] },

            { title: 'Accelerometer Trim', rows: [
                { cli: 'acc_trim_roll', label: 'Accelerometer Roll Trim' },
                { cli: 'acc_trim_pitch', label: 'Accelerometer Pitch Trim' }
            ] }
        ]
    },

    /* The Gyro tab, from src/tabs/gyro/*.svelte.
     *
     * Each filter here is switched on by a value rather than by a flag - a
     * lowpass is on when its type is not NONE, a notch when both its
     * frequency and cutoff are above zero - so the toggles name a predicate
     * in app.js rather than a setting, and the settings under a toggle are
     * hidden when it is off, as the Configurator hides them.
     */
    gyro: {
        boxes: [
            { title: 'Lowpass Filter', rows: [
                { sub: 'Lowpass Filter 1' },
                { toggle: 'lowpass1', label: 'Enable' },
                { cli: 'gyro_lpf1_type', label: 'Filter Type', enum: 'lowpassFilterTypes', when: 'lowpass1' },
                { cli: 'gyro_lpf1_static_hz', label: 'Cutoff Frequency', unit: 'Hz', when: 'lowpass1' },
                { toggle: 'lowpass1Dyn', label: 'Dynamic Cutoff', when: 'lowpass1' },
                { cli: 'gyro_lpf1_dyn_min_hz', label: 'Min Cutoff Frequency', unit: 'Hz', when: 'lowpass1Dyn' },
                { cli: 'gyro_lpf1_dyn_max_hz', label: 'Max Cutoff Frequency', unit: 'Hz', when: 'lowpass1Dyn' },
                { sub: 'Lowpass Filter 2' },
                { toggle: 'lowpass2', label: 'Enable' },
                { cli: 'gyro_lpf2_type', label: 'Filter Type', enum: 'lowpassFilterTypes', when: 'lowpass2' },
                { cli: 'gyro_lpf2_static_hz', label: 'Cutoff Frequency', unit: 'Hz', when: 'lowpass2' }
            ] },

            { title: 'Notch Filter', rows: [
                { sub: 'Notch Filter 1' },
                { toggle: 'notch1', label: 'Enable' },
                { cli: 'gyro_notch1_hz', label: 'Center Frequency', unit: 'Hz', when: 'notch1' },
                { cli: 'gyro_notch1_cutoff', label: 'Cutoff Frequency', unit: 'Hz', when: 'notch1' },
                { sub: 'Notch Filter 2' },
                { toggle: 'notch2', label: 'Enable' },
                { cli: 'gyro_notch2_hz', label: 'Center Frequency', unit: 'Hz', when: 'notch2' },
                { cli: 'gyro_notch2_cutoff', label: 'Cutoff Frequency', unit: 'Hz', when: 'notch2' }
            ] },

            { title: 'Dynamic Filter', rows: [
                { toggle: 'dynNotch', label: 'Enable' },
                { cli: 'dyn_notch_count', label: 'Notch Count', when: 'dynNotch' },
                { cli: 'dyn_notch_q', label: 'Notch Q', when: 'dynNotch' },
                { cli: 'dyn_notch_min_hz', label: 'Notch Minimum Frequency', unit: 'Hz', when: 'dynNotch' },
                { cli: 'dyn_notch_max_hz', label: 'Notch Maximum Frequency', unit: 'Hz', when: 'dynNotch' }
            ] },

            { title: 'RPM Filter', rows: [
                { toggle: 'rpmFilter', label: 'Enable' },
                { cli: 'gyro_rpm_notch_preset', label: 'Strength',
                  enum: 'rpmFilterStrengths', when: 'rpmFilter' },
                { cli: 'gyro_rpm_notch_min_hz', label: 'Minimum Frequency', unit: 'Hz', when: 'rpmFilter' }
            ] },

            { title: 'RPM Filter Notches', notches: true, when: 'rpmFilter', rows: [] }
        ]
    },

    /* The Power tab, from src/tabs/power.html and src/js/tabs/power.js.
     *
     * Power State and the live meter readings are telemetry; only the
     * configuration below comes out of a file. `div` is a display divisor the
     * MSP layer applies rather than the tab (MSPHelper.js reads the cell
     * voltages as readU16()/100), which is why it is not in scales-2.3.js.
     */
    power: {
        boxes: [
            { title: 'Battery', rows: [
                { cli: 'battery_meter', label: 'Battery Voltage Source', enum: 'batteryMeterTypes' },
                { cli: 'current_meter', label: 'Battery Current Source', enum: 'batteryMeterTypes' },
                { cli: 'vbat_max_cell_voltage', label: 'Maximum Cell Voltage', div: 100, dp: 2 },
                { cli: 'vbat_full_cell_voltage', label: 'Full Cell Voltage', div: 100, dp: 2 },
                { cli: 'vbat_warning_cell_voltage', label: 'Warning Cell Voltage', div: 100, dp: 2 },
                { cli: 'vbat_min_cell_voltage', label: 'Minimum Cell Voltage', div: 100, dp: 2 },
                { cli: 'battery_cell_count', label: 'Cell count' },
                { sub: 'Capacity [mAh]' },
                { cli: 'bat_capacity', idx: 0, label: 'Battery 1', unit: 'mAh', active: 'bat_profile' },
                { cli: 'bat_capacity', idx: 1, label: 'Battery 2', unit: 'mAh', active: 'bat_profile' },
                { cli: 'bat_capacity', idx: 2, label: 'Battery 3', unit: 'mAh', active: 'bat_profile' },
                { cli: 'bat_capacity', idx: 3, label: 'Battery 4', unit: 'mAh', active: 'bat_profile' },
                { cli: 'bat_capacity', idx: 4, label: 'Battery 5', unit: 'mAh', active: 'bat_profile' },
                { cli: 'bat_capacity', idx: 5, label: 'Battery 6', unit: 'mAh', active: 'bat_profile' }
            ] },

            { title: 'Smart Fuel', ver: '>=4.6', rows: [
                { cli: 'smartfuel', label: 'Smart Fuel Mode', enum: 'smartFuelSourceTypes' },
                { cli: 'smartfuel_voltage_drop_rate', label: 'Smart Fuel Voltage Drop Rate', unit: 'mV/s' },
                { cli: 'smartfuel_charge_drop_rate', label: 'Smart Fuel Charge Drop Rate', unit: '%/s', div: 100 },
                { cli: 'smartfuel_sag_gain', label: 'Smart Fuel Sag Gain', unit: '%' }
            ] },

            { title: 'Voltage Meters', rows: [
                { sub: 'Battery' },
                { cli: 'vbat_scale', label: 'Scale' },
                { cli: 'vbat_divider', label: 'Divider' },
                { sub: 'BEC' },
                { cli: 'vbec_scale', label: 'Scale' },
                { cli: 'vbec_divider', label: 'Divider' },
                { sub: '5V' },
                { cli: 'vbus_scale', label: 'Scale' },
                { cli: 'vbus_divider', label: 'Divider' }
            ] }
        ]
    },

    /* The Motors tab, from src/tabs/motors/*.svelte.
     *
     * Rotor Speed, Throttle Override and the per-motor panels are live
     * telemetry, so there is nothing in a file for them and they are not here.
     */
    motors: {
        boxes: [
            { title: 'Throttle', rows: [
                { cli: 'motor_pwm_protocol', label: 'Throttle Protocol' },
                /* Everything below is hidden for a digital protocol - the
                 * PWM timing and endpoints only mean anything for an
                 * analogue one (src/tabs/motors/Throttle.svelte). */
                { cli: 'motor_pwm_rate', label: 'Update Frequency', unit: 'Hz', when: 'notDshot' },
                { cli: 'use_unsynced_pwm', label: 'Unsyncronised ESC update', when: 'notDshot' },
                { sub: 'Throttle Range' },
                { cli: 'mincommand', label: 'Motor Off', unit: 'μs', when: 'notDshot' },
                { cli: 'minthrottle', label: 'Low Throttle', unit: 'μs', when: 'notDshot' },
                { cli: 'maxthrottle', label: 'High Throttle', unit: 'μs', when: 'notDshot' }
            ] },

            { title: 'ESC Telemetry', rows: [
                { cli: 'esc_sensor_protocol', label: 'Telemetry Protocol', enum: 'escTelemetryProtocols' },
                { sub: 'Signaling' },
                { cli: 'esc_sensor_halfduplex', label: 'Half-Duplex' },
                { cli: 'esc_sensor_pinswap', label: 'Pin Swap' },
                { sub: 'Sensor Correction' },
                { cli: 'esc_sensor_voltage_correction', label: 'Voltage', unit: '%' },
                { cli: 'esc_sensor_current_correction', label: 'Current', unit: '%' },
                { cli: 'esc_sensor_consumption_correction', label: 'Consumption', unit: '%' }
            ] },

            { title: 'RPM', rows: [
                { feature: 'FREQ_SENSOR', label: 'RPM Sensor' },
                { cli: 'dshot_bidir', label: 'Dshot RPM Telemetry' },
                { ratio: 'main_rotor_gear_ratio', label: 'Main Rotor Gear Ratio' },
                { ratio: 'tail_rotor_gear_ratio', label: 'Tail Rotor Gear Ratio' },
                { cli: 'motor_poles', idx: 0, label: 'Main Motor Pole Count' },
                /* The Configurator shows one pole-count row per motor the board
                 * reports. A file cannot say how many motors there are, so the
                 * tail type stands in for it: a motorised tail is the second
                 * motor. */
                { cli: 'motor_poles', idx: 1, label: 'Tail Motor Pole Count', when: 'motorisedTail' }
            ] }
        ]
    },

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
    /* Divisors on rows below come from src/js/tabs/profiles.js, which divides
     * on the way to the control: error_decay_time_ground / 10, the rescue
     * collectives and times / 10, the hover altitude / 100. */
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
                /* Dropped from the page at MSP API 12.9 (firmware 4.6). */
                { cli: 'error_rotation', label: 'Piro Compensation', ver: '<4.6' },
                { group: 'Ground Error Decay', on: 'error_decay_time_ground', rows: [
                    { cli: 'error_decay_time_ground', label: 'Decay Time', unit: 's', div: 10 }
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
                    { cli: 'cyclic_cross_coupling_cutoff', label: 'Cross-Coupling Cutoff Frequency', unit: 'Hz', div: 10, dp: 1 }
                ] },
                { cli: 'error_decay_time_cyclic', label: 'Error Decay time', unit: 's', div: 10 },
                { cli: 'error_decay_limit_cyclic', label: 'Error Decay maximum rate', unit: '°/s' }
            ] },

            { title: 'Tail Rotor Settings', rows: [
                { cli: 'yaw_cw_stop_gain', label: 'CW Yaw Stop Gain' },
                { cli: 'yaw_ccw_stop_gain', label: 'CCW Yaw Stop Gain' },
                { cli: 'yaw_precomp_cutoff', label: 'Yaw Precomp Cutoff', unit: 'Hz' },
                { cli: 'yaw_cyclic_ff_gain', label: 'Cyclic Feedforward Gain' },
                { cli: 'yaw_collective_ff_gain', label: 'Collective Feedforward Gain' },
                { cli: 'yaw_inertia_precomp_gain', label: 'Inertia Precomp Gain' },
                { cli: 'yaw_inertia_precomp_cutoff', label: 'Inertia Precomp Cutoff', unit: 'Hz', div: 10, dp: 1 },
                /* The yaw error-decay controls exist in the Configurator's
                 * markup but it never fills them in - the two lines that would
                 * are commented out in profiles.js - so its page shows them
                 * empty and this one leaves them to the box below. */
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
                    { cli: 'rescue_flip', label: 'Flip to upright', enum: 'rescueFlipMode' },
                    { cli: 'rescue_pull_up_collective', label: 'Pull-up Collective', unit: '%', div: 10 },
                    { cli: 'rescue_pull_up_time', label: 'Pull-up Time', unit: 's', div: 10, dp: 1 },
                    { cli: 'rescue_climb_collective', label: 'Climb Collective', unit: '%', div: 10 },
                    { cli: 'rescue_climb_time', label: 'Climb Time', unit: 's', div: 10, dp: 1 },
                    { cli: 'rescue_hover_collective', label: 'Hover Collective', unit: '%', div: 10 },
                    { cli: 'rescue_flip_time', label: 'Flip Fail Time', unit: 's', div: 10, dp: 1 },
                    { cli: 'rescue_exit_time', label: 'Exit Time', unit: 's', div: 10, dp: 1 },
                    { cli: 'rescue_level_gain', label: 'Leveling Gain' },
                    { cli: 'rescue_flip_gain', label: 'Flip-to-Upright Gain' },
                    { cli: 'rescue_max_sp_rate', label: 'Max Levelling Rate', unit: '°/s' },
                    { cli: 'rescue_max_sp_accel', label: 'Max Leveling Acceleration', unit: '°/s²' }
                ] },
                /* Altitude hold appears only for a rescue mode past CLIMB
                 * (profiles.js: rescueMode > 1), and takes the maximum
                 * collective with it. */
                { group: 'Enable Altitude Hold', on: 'rescue_hover_altitude',
                  when: 'rescueAltHold', rows: [
                    { cli: 'rescue_hover_altitude', label: 'Hover Altitude', unit: 'm', div: 100, dp: 2 },
                    { cli: 'rescue_alt_p_gain', label: 'Altitude P-Gain' },
                    { cli: 'rescue_alt_i_gain', label: 'Altitude I-Gain' },
                    { cli: 'rescue_alt_d_gain', label: 'Altitude D-Gain' },
                    { cli: 'rescue_max_collective', label: 'Maximum Collective', unit: '%', div: 10 }
                ] }
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

/* Wording the Configurator keeps in JavaScript rather than in its markup, so
 * tools/gen_enums.py cannot read it from a dropdown. Transcribed, with the
 * entries each API version adds, from src/tabs/motors/state.svelte.js. */
window.RF_ENUM_LISTS = {
    /* src/js/tabs/power.js getBatteryMeterTypes()/getSmartFuelSourceTypes(),
     * with the entry API 12.9 adds. */
    /* src/tabs/gyro/LowpassFilter.svelte FILTER_TYPES; only two are offered,
     * but the firmware's table is longer, so the rest keep their own names. */
    lowpassFilterTypes: [
        'Disabled', '1ˢᵗ order', '2ⁿᵈ order',
        'PT1', 'PT2', 'PT3', 'Order1', 'Butter', 'Bessel', 'Damped'
    ],
    /* src/tabs/gyro/RpmFilter.svelte filterStrengths. */
    rpmFilterStrengths: ['Custom', 'Low', 'Medium', 'High'],

    /* src/js/tabs/rates.js getRatesTypes(), with the entry API 12.9 adds. */
    ratesTypes: ['None', 'Betaflight', 'Raceflight', 'KISS', 'Actual',
                 'QuickRates', 'Rotorflight'],

    batteryMeterTypes: ['None', 'Battery ADC', 'ESC Telemetry', 'FrSky Sensor'],
    smartFuelSourceTypes: ['Off', 'Voltage', 'Current', 'Combined'],

    escTelemetryProtocols: [
        'Disabled', 'BLHeli32', 'Hobbywing Platinum V4 / FlyFun V5',
        'Hobbywing Platinum V5', 'Scorpion', 'Kontronik', 'OMPHobby', 'ZTW',
        'APD', 'OpenYGE', 'FLYROTOR', 'Graupner', 'XDFLY', 'FrSky F.BUS'
    ]
};

/* How the Rates tab presents a rate profile, from src/js/tabs/rates.js.
 *
 * Every rate field reaches the Configurator as the stored byte divided by 100
 * (MSPHelper.js), and the tab then multiplies it by a factor that depends on
 * the rates type and prints it to a fixed number of decimals. `f` below is the
 * two combined, so `f` x the stored value is what the pilot sees:
 * roll_rc_rate = 32 under Raceflight is 32 x 10 = 320.
 *
 * `maxVel` names the curve the Max Vel column comes from; where the viewer has
 * not ported that curve the column is left blank rather than guessed at.
 */
window.RF_RATES = {
    types: ['None', 'Betaflight', 'Raceflight', 'KISS', 'Actual', 'QuickRates', 'Rotorflight'],
    byType: {
        0: { labels: ['RC Rate', 'Rate', 'RC Expo'],
             rate: [1, 0], coll_rate: [1, 0], srate: [1, 0], coll_srate: [1, 0],
             expo: [1, 0], coll_expo: [1, 0] },
        1: { labels: ['RC Rate', 'Rate', 'RC Expo'],
             rate: [0.01, 2], coll_rate: [0.01, 2], srate: [0.01, 2], coll_srate: [0.01, 2],
             expo: [0.01, 2], coll_expo: [0.01, 2] },
        2: { labels: ['Rate', 'Acro+', 'Expo'],
             rate: [10, 0], coll_rate: [0.25, 1], srate: [1, 0], coll_srate: [1, 0],
             expo: [1, 0], coll_expo: [1, 0], maxVel: 'raceflight' },
        3: { labels: ['RC Rate', 'Rate', 'RC Expo'],
             rate: [0.01, 2], coll_rate: [0.01, 2], srate: [0.01, 2], coll_srate: [0.01, 2],
             expo: [0.01, 2], coll_expo: [0.01, 2] },
        4: { labels: ['Rate', 'Acro+', 'Expo'],
             rate: [10, 0], coll_rate: [0.25, 1], srate: [10, 0], coll_srate: [0.25, 1],
             expo: [0.01, 2], coll_expo: [0.01, 2] },
        5: { labels: ['RC Rate', 'Acro+', 'Expo'],
             rate: [0.01, 2], coll_rate: [0.01, 2], srate: [10, 0], coll_srate: [4.8, 0],
             expo: [0.01, 2], coll_expo: [0.01, 2] },
        6: { labels: ['Rate', 'Curve Shape', 'Expo'],
             rate: [5, 0], coll_rate: [0.125, 2], srate: [1, 0], coll_srate: [1, 0],
             expo: [1, 0], coll_expo: [1, 0], maxVel: 'rotorflight' }
    }
};
