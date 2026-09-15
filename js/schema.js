/*
 * Where each CLI setting is shown, and what to call it.
 *
 * The Rotorflight Configurator groups settings by function, not by the firmware's
 * parameter groups, but the two line up closely: a PG is the default bucket, and
 * the exceptions (PG_PID_PROFILE in particular, which holds PID, governor,
 * rescue and self-level settings all at once) are split by name.
 *
 * Any setting that no rule claims still appears - in its parameter group's own
 * panel on the tab that group maps to, and in the "All settings" tab. Nothing in
 * a loaded file is ever silently dropped.
 */

(function (global) {
    'use strict';

    var TABS = [
        { id: 'setup', name: 'Setup', icon: 'setup' },
        { id: 'configuration', name: 'Configuration', icon: 'config' },
        { id: 'ports', name: 'Ports', icon: 'ports' },
        { id: 'receiver', name: 'Receiver', icon: 'rx' },
        { id: 'modes', name: 'Modes', icon: 'modes' },
        { id: 'adjustments', name: 'Adjustments', icon: 'adjust' },
        { id: 'failsafe', name: 'Failsafe', icon: 'failsafe' },
        { id: 'power', name: 'Power', icon: 'power' },
        { id: 'motors', name: 'Motors', icon: 'motor' },
        { id: 'governor', name: 'Governor', icon: 'governor' },
        { id: 'servos', name: 'Servos', icon: 'servo' },
        { id: 'mixer', name: 'Mixer', icon: 'mixer' },
        { id: 'filters', name: 'Filters', icon: 'gyro' },
        { id: 'rates', name: 'Rates', icon: 'rates' },
        { id: 'profiles', name: 'PID Profiles', icon: 'pid' },
        { id: 'rescue', name: 'Rescue', icon: 'rescue' },
        { id: 'blackbox', name: 'Blackbox', icon: 'data' },
        { id: 'osd', name: 'OSD', icon: 'osd' },
        { id: 'ledstrip', name: 'LED Strip', icon: 'led' },
        { id: 'beepers', name: 'Beepers', icon: 'beeper' },
        { id: 'gps', name: 'GPS', icon: 'gps' },
        { id: 'board', name: 'Board', icon: 'board' },
        { id: 'all', name: 'All Settings', icon: 'list' },
        { id: 'cli', name: 'CLI', icon: 'cli' }
    ];

    /* Default tab for every firmware parameter group. */
    var PG_TAB = {
        PG_ACCELEROMETER_CONFIG: 'configuration',
        PG_ADC_CONFIG: 'power',
        PG_ARMING_CONFIG: 'configuration',
        PG_BAROMETER_CONFIG: 'configuration',
        PG_BATTERY_CONFIG: 'power',
        PG_BEEPER_CONFIG: 'beepers',
        PG_BEEPER_DEV_CONFIG: 'beepers',
        PG_BLACKBOX_CONFIG: 'blackbox',
        PG_BOARD_ALIGNMENT: 'configuration',
        PG_BOARD_CONFIG: 'board',
        PG_BUS_SERVO_CONFIG: 'servos',
        PG_DRIVER_FBUS_MASTER_CONFIG: 'ports',
        PG_DRIVER_SPORT_MASTER_CONFIG: 'ports',
        PG_CAMERA_CONTROL_CONFIG: 'board',
        PG_COMPASS_CONFIG: 'configuration',
        PG_CONTROL_RATE_PROFILES: 'rates',
        PG_CURRENT_SENSOR_ADC_CONFIG: 'power',
        PG_DASHBOARD_CONFIG: 'board',
        PG_DISPLAY_PORT_MAX7456_CONFIG: 'osd',
        PG_DISPLAY_PORT_MSP_CONFIG: 'osd',
        PG_DRIVER_SBUS_OUT_CONFIG: 'board',
        PG_DYN_NOTCH_CONFIG: 'filters',
        PG_ESC_SENSOR_CONFIG: 'motors',
        PG_FAILSAFE_CONFIG: 'failsafe',
        PG_FLASH_CONFIG: 'blackbox',
        PG_FLYSKY_CONFIG: 'receiver',
        PG_FREQ_SENSOR_CONFIG: 'motors',
        PG_GENERIC_MIXER_CONFIG: 'mixer',
        PG_GOVERNOR_CONFIG: 'governor',
        PG_GPS_CONFIG: 'gps',
        PG_GPS_RESCUE: 'gps',
        PG_GYRO_CONFIG: 'filters',
        PG_GYRO_DEVICE_CONFIG: 'board',
        PG_I2C_CONFIG: 'board',
        PG_IMU_CONFIG: 'configuration',
        PG_LED_STRIP_CONFIG: 'ledstrip',
        PG_LED_STRIP_STATUS_MODE_CONFIG: 'ledstrip',
        PG_MAX7456_CONFIG: 'osd',
        PG_MCO_CONFIG: 'board',
        PG_MODE_ACTIVATION_CONFIG: 'modes',
        PG_MOTOR_CONFIG: 'motors',
        PG_OSD_CONFIG: 'osd',
        PG_OSD_ELEMENT_CONFIG: 'osd',
        PG_PID_CONFIG: 'profiles',
        PG_PID_PROFILE: 'profiles',
        PG_PILOT_CONFIG: 'configuration',
        PG_PINIOBOX_CONFIG: 'board',
        PG_PINIO_CONFIG: 'board',
        PG_POSITION: 'gps',
        PG_PWM_CONFIG: 'board',
        PG_RANGEFINDER_CONFIG: 'board',
        PG_RCDEVICE_CONFIG: 'board',
        PG_RC_CONTROLS_CONFIG: 'receiver',
        PG_RPM_FILTER_CONFIG: 'filters',
        PG_RX_CC2500_SPI_CONFIG: 'receiver',
        PG_RX_CONFIG: 'receiver',
        PG_RX_EXPRESSLRS_SPI_CONFIG: 'receiver',
        PG_RX_SPEKTRUM_SPI_CONFIG: 'receiver',
        PG_RX_SPI_CONFIG: 'receiver',
        PG_SCHEDULER_CONFIG: 'configuration',
        PG_SDCARD_CONFIG: 'blackbox',
        PG_SDIO_CONFIG: 'board',
        PG_SERIAL_CONFIG: 'ports',
        PG_STATS_CONFIG: 'configuration',
        PG_STATUS_LED_CONFIG: 'board',
        PG_SYSTEM_CONFIG: 'configuration',
        PG_TELEMETRY_CONFIG: 'receiver',
        PG_TIME_CONFIG: 'configuration',
        PG_USB_CONFIG: 'board',
        PG_VCD_CONFIG: 'osd',
        PG_VOLTAGE_SENSOR_ADC_CONFIG: 'power',
        PG_VTX_CONFIG: 'board',
        PG_VTX_IO_CONFIG: 'board',
        PG_VTX_SETTINGS_CONFIG: 'board'
    };

    /* Name-based overrides, applied before PG_TAB. First match wins. */
    var NAME_TAB = [
        [/^gov_/, 'governor'],
        [/^rescue_/, 'rescue'],
        [/^gps_rescue_/, 'gps'],
        [/^(acro_trainer_|angle_level|horizon_)/, 'profiles'],
        [/^gyro_rpm_notch_/, 'filters']
    ];

    /* Curated panels, in the order the Configurator shows the equivalent boxes.
     * `names` lists CLI setting names; missing ones are skipped silently. */
    var SECTIONS = [
        // ---- Configuration -------------------------------------------------
        { tab: 'configuration', title: 'Personalization',
          names: ['name', 'model_id', 'display_name', 'pilot_name'] },
        { tab: 'configuration', title: 'Board Orientation',
          names: ['align_board_roll', 'align_board_pitch', 'align_board_yaw',
                  'align_gyro', 'gyro_1_align_roll', 'gyro_1_align_pitch', 'gyro_1_align_yaw'] },
        { tab: 'configuration', title: 'Arming',
          names: ['small_angle', 'auto_disarm_delay', 'gyro_cal_on_first_arm',
                  'runaway_takeoff_prevention'] },
        { tab: 'configuration', title: 'Accelerometer',
          names: ['acc_hardware', 'acc_lpf_hz', 'acc_trim_roll', 'acc_trim_pitch',
                  'acc_calibration'] },
        { tab: 'configuration', title: 'Attitude Estimation',
          names: ['imu_dcm_kp', 'imu_dcm_ki', 'imu_process_denom'] },
        { tab: 'configuration', title: 'Flight Statistics',
          names: ['stats', 'stats_total_flights', 'stats_total_time_s', 'stats_total_dist_m',
                  'stats_min_armed_time_s'] },
        { tab: 'configuration', title: 'Stick Commands',
          names: ['enable_stick_arming', 'enable_stick_commands',
                  'pwr_on_arm_grace', 'timezone_offset_minutes'] },
        { tab: 'configuration', title: 'Wiggle Indicator',
          names: ['wiggle_enable_ready', 'wiggle_enable_armed', 'wiggle_enable_error',
                  'wiggle_enable_fatal', 'wiggle_frequency', 'wiggle_strength'] },
        { tab: 'configuration', title: 'Model Parameters',
          names: ['model_set_name', 'model_tell_capacity',
                  'model_param1_type', 'model_param1_value',
                  'model_param2_type', 'model_param2_value',
                  'model_param3_type', 'model_param3_value'] },
        { tab: 'configuration', title: 'Magnetometer',
          names: ['mag_hardware', 'align_mag', 'mag_align_roll', 'mag_align_pitch',
                  'mag_align_yaw', 'mag_calibration', 'mag_bustype',
                  'mag_i2c_device', 'mag_i2c_address', 'mag_spi_device'] },
        { tab: 'configuration', title: 'Barometer',
          names: ['baro_hardware', 'baro_bustype', 'baro_i2c_device',
                  'baro_i2c_address', 'baro_spi_device'] },
        { tab: 'configuration', title: 'Debug & System',
          names: ['debug_mode', 'debug_axis', 'task_statistics',
                  'cpu_overclock', 'system_hse_mhz'] },

        // ---- Receiver ------------------------------------------------------
        { tab: 'receiver', title: 'Receiver Mode',
          names: ['serialrx_provider', 'serialrx_inverted', 'serialrx_halfduplex',
                  'rx_spi_protocol', 'msp_override_channels_mask'] },
        { tab: 'receiver', title: 'Channel Map & Range',
          names: ['rc_map', 'rx_min_usec', 'rx_max_usec'] },
        { tab: 'receiver', title: 'Stick Configuration',
          names: ['rc_center', 'rc_deflection', 'rc_arm_throttle', 'rc_min_throttle',
                  'rc_max_throttle', 'rc_deadband', 'rc_yaw_deadband',
                  'rc_threshold', 'rc_smoothness', 'deadband', 'yaw_deadband',
                  'rx_pulse_min', 'rx_pulse_max'] },
        { tab: 'receiver', title: 'RSSI',
          names: ['rssi_channel', 'rssi_src_frame_errors', 'rssi_scale', 'rssi_offset',
                  'rssi_invert', 'rssi_src_frame_lpf_period'] },
        { tab: 'receiver', title: 'Telemetry',
          names: ['telemetry_inverted', 'halfduplex', 'telemetry_sensors',
                  'tlm_inverted', 'tlm_halfduplex', 'tlm_pinswap', 'telemetry_interval',
                  'serialrx_pinswap', 'crsf_use_negotiated_baud', 'crsf_use_rx_snr',
                  'crsf_telemetry_mode', 'crsf_telemetry_link_rate',
                  'crsf_telemetry_link_ratio', 'report_cell_voltage',
                  'frsky_default_latitude', 'frsky_default_longitude'] },

        // ---- Failsafe ------------------------------------------------------
        { tab: 'failsafe', title: 'Failsafe',
          names: ['failsafe_delay', 'failsafe_off_delay', 'failsafe_throttle',
                  'failsafe_switch_mode', 'failsafe_throttle_low_delay',
                  'failsafe_procedure', 'failsafe_recovery_delay', 'failsafe_stick_threshold'] },

        // ---- Power ---------------------------------------------------------
        { tab: 'power', title: 'Battery',
          names: ['battery_meter', 'battery_cell_count', 'bat_capacity',
                  'vbat_max_cell_voltage', 'vbat_full_cell_voltage',
                  'vbat_min_cell_voltage', 'vbat_warning_cell_voltage',
                  'vbat_scale', 'vbat_divider', 'vbat_multiplier',
                  'vbat_lpf_period', 'vbat_sag_lpf_period',
                  'vbat_lpf_hz', 'vbat_update_hz', 'vbat_detect_cell_voltage',
                  'vbat_hysteresis', 'bat_profile'] },
        { tab: 'power', title: 'Battery Alerts',
          names: ['use_vbat_alerts', 'vbat_cutoff_percent',
                  'vbat_duration_for_warning', 'vbat_duration_for_critical',
                  'use_cbat_alerts', 'cbat_alert_percent'] },
        { tab: 'power', title: 'Smart Fuel Gauge',
          names: ['smartfuel', 'smartfuel_sag_gain', 'smartfuel_voltage_drop_rate',
                  'smartfuel_charge_drop_rate'] },
        { tab: 'power', title: 'Current Meter',
          names: ['current_meter', 'ibat_scale', 'ibat_offset', 'ibat_lpf_period',
                  'ibat_lpf_hz', 'ibat_update_hz', 'mah_used_ref'] },

        // ---- Motors --------------------------------------------------------
        { tab: 'motors', title: 'ESC / Motor Protocol',
          names: ['motor_pwm_protocol', 'motor_pwm_rate', 'motor_control_mode',
                  'use_unsynced_pwm', 'dshot_bidir', 'dshot_burst',
                  'dshot_bitbang', 'dshot_bitbang_timer'] },
        { tab: 'motors', title: 'Throttle Range',
          names: ['min_command', 'min_throttle', 'max_throttle'] },
        { tab: 'motors', title: 'Rotor Geometry',
          names: ['motor_poles', 'main_rotor_gear_ratio', 'tail_rotor_gear_ratio',
                  'motor_rpm_lpf', 'motor_rpm_factor'] },
        { tab: 'motors', title: 'ESC Telemetry',
          names: ['esc_sensor_protocol', 'esc_sensor_half_duplex',
                  'esc_sensor_update_hz', 'esc_sensor_current_offset',
                  'esc_sensor_hw4_current_offset', 'esc_sensor_hw4_current_gain',
                  'esc_sensor_hw4_voltage_gain', 'esc_sensor_pin_swap',
                  'esc_sensor_halfduplex', 'esc_sensor_pinswap',
                  'esc_sensor_filter_cutoff', 'esc_sensor_voltage_correction',
                  'esc_sensor_current_correction', 'esc_sensor_consumption_correction'] },
        { tab: 'motors', title: 'Frequency Sensor',
          names: ['freq_sensor_pin_swap', 'freq_sensor_filter',
                  'freq_input_pull', 'freq_input_edge', 'freq_input_minhz'] },

        // ---- Governor ------------------------------------------------------
        { tab: 'governor', title: 'Governor Mode',
          names: ['gov_mode', 'gov_throttle_type', 'gov_handover_throttle',
                  'gov_idle_throttle', 'gov_auto_throttle', 'gov_bypass_throttle'] },
        { tab: 'governor', title: 'Spoolup & Timings',
          names: ['gov_startup_time', 'gov_spoolup_time', 'gov_spooldown_time',
                  'gov_tracking_time', 'gov_recovery_time',
                  'gov_autorotation_timeout', 'gov_throttle_hold_timeout',
                  'gov_zero_throttle_timeout', 'gov_lost_headspeed_timeout',
                  'gov_autorotation_bailout_time', 'gov_autorotation_min_entry_time',
                  'gov_spoolup_min_throttle'] },
        { tab: 'governor', title: 'Governor Filters',
          names: ['gov_rpm_filter', 'gov_pwr_filter', 'gov_tta_filter',
                  'gov_d_filter', 'gov_ff_filter'] },
        { tab: 'governor', title: 'Per-Profile Gains', profileScope: true,
          names: ['gov_headspeed', 'gov_gain', 'gov_p_gain', 'gov_i_gain',
                  'gov_d_gain', 'gov_f_gain', 'gov_p_limit', 'gov_i_limit',
                  'gov_d_limit', 'gov_f_limit', 'gov_tta_gain', 'gov_tta_limit',
                  'gov_yaw_ff_weight', 'gov_cyclic_ff_weight',
                  'gov_collective_ff_weight', 'gov_collective_curve',
                  'gov_max_throttle', 'gov_min_throttle', 'gov_dyn_min_throttle',
                  'gov_use_dyn_min_throttle', 'gov_use_pid_spoolup',
                  'gov_use_voltage_comp', 'gov_use_fallback_precomp',
                  'gov_fallback_drop'] },

        // ---- Mixer ---------------------------------------------------------
        { tab: 'mixer', title: 'Swashplate',
          names: ['swash_type', 'swash_ring', 'swash_phase', 'swash_pitch_limit',
                  'swash_trim', 'swash_roll_trim', 'swash_pitch_trim',
                  'swash_collective_trim', 'swash_geo_correction'] },
        { tab: 'mixer', title: 'Tail & Rotor',
          names: ['main_rotor_dir', 'tail_rotor_mode', 'tail_motor_idle',
                  'tail_center_trim', 'swash_tta_precomp'] },
        { tab: 'mixer', title: 'Collective Tilt Correction',
          names: ['collective_tilt_correction_pos', 'collective_tilt_correction_neg'] },

        // ---- Filters -------------------------------------------------------
        { tab: 'filters', title: 'Gyro Lowpass 1',
          names: ['gyro_lpf1_type', 'gyro_lpf1_static_hz',
                  'gyro_lpf1_dyn_min_hz', 'gyro_lpf1_dyn_max_hz'] },
        { tab: 'filters', title: 'Gyro Lowpass 2',
          names: ['gyro_lpf2_type', 'gyro_lpf2_static_hz'] },
        { tab: 'filters', title: 'Gyro Notches',
          names: ['gyro_notch1_hz', 'gyro_notch1_cutoff',
                  'gyro_notch2_hz', 'gyro_notch2_cutoff'] },
        { tab: 'filters', title: 'Dynamic Notch',
          names: ['dyn_notch_count', 'dyn_notch_q', 'dyn_notch_min_hz', 'dyn_notch_max_hz'] },
        { tab: 'filters', title: 'RPM Filter',
          names: ['gyro_rpm_notch_preset', 'gyro_rpm_notch_min_hz',
                  'gyro_rpm_notch_source_roll', 'gyro_rpm_notch_q_roll',
                  'gyro_rpm_notch_center_roll',
                  'gyro_rpm_notch_source_pitch', 'gyro_rpm_notch_q_pitch',
                  'gyro_rpm_notch_center_pitch',
                  'gyro_rpm_notch_source_yaw', 'gyro_rpm_notch_q_yaw',
                  'gyro_rpm_notch_center_yaw'] },
        { tab: 'filters', title: 'Gyro Hardware',
          names: ['gyro_hardware_lpf', 'gyro_decimation_hz', 'gyro_rate_sync',
                  'gyro_to_use', 'gyro_high_range', 'gyro_overflow_detect',
                  'gyro_calib_duration', 'gyro_calib_noise_limit', 'gyro_offset_yaw'] },

        // ---- Rates ---------------------------------------------------------
        { tab: 'rates', title: 'Rates', rateScope: true,
          names: ['rates_type', 'rateprofile_name',
                  'roll_rc_rate', 'roll_srate', 'roll_expo', 'roll_accel_limit',
                  'pitch_rc_rate', 'pitch_srate', 'pitch_expo', 'pitch_accel_limit',
                  'yaw_rc_rate', 'yaw_srate', 'yaw_expo', 'yaw_accel_limit',
                  'collective_rc_rate', 'collective_srate', 'collective_expo',
                  'collective_accel_limit', 'quickrates_rc_expo'] },
        { tab: 'rates', title: 'Setpoint Boost', rateScope: true,
          names: ['setpoint_boost_gain', 'setpoint_boost_cutoff',
                  'roll_response', 'pitch_response', 'yaw_response', 'collective_response'] },
        { tab: 'rates', title: 'Dynamics', rateScope: true,
          names: ['cyclic_ring', 'cyclic_polar', 'roll_level_expo', 'pitch_level_expo',
                  'yaw_dynamic_ceiling_gain', 'yaw_dynamic_deadband_gain',
                  'yaw_dynamic_deadband_filter', 'yaw_dynamic_deadband_cutoff'] },

        // ---- PID profiles --------------------------------------------------
        { tab: 'profiles', title: 'PID Gains', profileScope: true, pidTable: true,
          names: ['pitch_p_gain', 'pitch_i_gain', 'pitch_d_gain', 'pitch_f_gain',
                  'pitch_b_gain', 'pitch_o_gain',
                  'roll_p_gain', 'roll_i_gain', 'roll_d_gain', 'roll_f_gain',
                  'roll_b_gain', 'roll_o_gain',
                  'yaw_p_gain', 'yaw_i_gain', 'yaw_d_gain', 'yaw_f_gain',
                  'yaw_b_gain', 'yaw_o_gain'] },
        { tab: 'profiles', title: 'PID Bandwidth', profileScope: true,
          names: ['pitch_d_cutoff', 'pitch_b_cutoff', 'pitch_gyro_cutoff',
                  'roll_d_cutoff', 'roll_b_cutoff', 'roll_gyro_cutoff',
                  'yaw_d_cutoff', 'yaw_b_cutoff', 'yaw_gyro_cutoff',
                  'pid_mode', 'pid_gyro_filter_type'] },
        { tab: 'profiles', title: 'Error & I-term', profileScope: true,
          names: ['error_limit', 'offset_limit',
                  'error_decay_time_ground', 'error_decay_time_cyclic',
                  'error_decay_time_yaw', 'error_decay_limit_cyclic',
                  'error_decay_limit_yaw', 'error_rotation',
                  'iterm_relax_type', 'iterm_relax_level', 'iterm_relax_cutoff',
                  'offset_flood_relax_level', 'offset_flood_relax_cutoff'] },
        { tab: 'profiles', title: 'Yaw Precompensation', profileScope: true,
          names: ['yaw_cw_stop_gain', 'yaw_ccw_stop_gain', 'yaw_precomp_cutoff',
                  'yaw_precomp_filter_type', 'yaw_cyclic_ff_gain',
                  'yaw_collective_ff_gain', 'yaw_inertia_precomp_gain',
                  'yaw_inertia_precomp_cutoff', 'pitch_collective_ff_gain'] },
        { tab: 'profiles', title: 'Cross Coupling', profileScope: true,
          names: ['cyclic_cross_coupling_gain', 'cyclic_cross_coupling_ratio',
                  'cyclic_cross_coupling_cutoff'] },
        { tab: 'profiles', title: 'Level Modes', profileScope: true,
          names: ['angle_level_strength', 'angle_level_limit',
                  'horizon_level_strength', 'horizon_transition',
                  'horizon_tilt_effect', 'horizon_tilt_expert_mode',
                  'acro_trainer_gain', 'acro_trainer_angle_limit',
                  'acro_trainer_lookahead_ms'] },
        { tab: 'profiles', title: 'Profile Name & Loop', profileScope: true,
          names: ['profile_name', 'pid_process_denom', 'filter_process_denom'] },

        // ---- Rescue --------------------------------------------------------
        { tab: 'rescue', title: 'Rescue', profileScope: true,
          names: ['rescue_mode', 'rescue_flip', 'rescue_flip_gain', 'rescue_flip_time',
                  'rescue_level_gain', 'rescue_pull_up_time', 'rescue_pull_up_collective',
                  'rescue_climb_time', 'rescue_climb_collective',
                  'rescue_hover_altitude', 'rescue_hover_collective',
                  'rescue_exit_time', 'rescue_max_collective',
                  'rescue_max_sp_rate', 'rescue_max_sp_accel',
                  'rescue_alt_p_gain', 'rescue_alt_i_gain', 'rescue_alt_d_gain'] },

        // ---- Blackbox ------------------------------------------------------
        { tab: 'blackbox', title: 'Blackbox',
          names: ['blackbox_device', 'blackbox_mode', 'blackbox_rate_denom',
                  'blackbox_initial_erase_kb', 'blackbox_rolling_erase',
                  'blackbox_gracetime', 'blackbox_grace_period'] },
        { tab: 'blackbox', title: 'Logged Fields',
          names: ['blackbox_log_attitude', 'blackbox_log_alt', 'blackbox_log_vbus',
                  'blackbox_log_temp', 'blackbox_log_esc', 'blackbox_log_bec',
                  'blackbox_log_battery', 'blackbox_log_rc', 'blackbox_log_gyro',
                  'blackbox_log_setpoint', 'blackbox_log_pid', 'blackbox_log_mixer',
                  'blackbox_log_servos', 'blackbox_log_motors', 'blackbox_log_gps',
                  'blackbox_log_rssi', 'blackbox_log_debug',
                  'blackbox_log_acc', 'blackbox_log_command', 'blackbox_log_esc2',
                  'blackbox_log_governor', 'blackbox_log_gyro_raw', 'blackbox_log_mag',
                  'blackbox_log_rpm', 'blackbox_log_vbec'] },
        { tab: 'blackbox', title: 'Storage',
          names: ['sdcard_mode', 'sdcard_detect_inverted', 'sdcard_spi_bus',
                  'flash_spi_bus'] }
    ];

    /* Labels that reading the CLI name alone would get wrong or clumsy. */
    var LABELS = {
        name: 'Craft name',
        model_id: 'Model ID',
        acc_calibration: 'Accelerometer calibration',
        bat_capacity: 'Battery capacity',
        battery_meter: 'Voltage meter source',
        current_meter: 'Current meter source',
        min_command: 'Motor stop command',
        min_throttle: 'Motor minimum throttle',
        max_throttle: 'Motor maximum throttle',
        rc_arm_throttle: 'Arming throttle',
        rc_min_throttle: 'Throttle range low',
        rc_max_throttle: 'Throttle range high',
        motor_poles: 'Motor pole count',
        main_rotor_gear_ratio: 'Main rotor gear ratio (pinion, main)',
        tail_rotor_gear_ratio: 'Tail rotor gear ratio (rear, front)',
        gov_mode: 'Governor mode',
        gov_gain: 'Governor master gain',
        gov_headspeed: 'Target headspeed',
        gov_ff_filter: 'Feedforward filter',
        gov_tta_gain: 'Tail torque assist gain',
        gov_tta_limit: 'Tail torque assist limit',
        swash_type: 'Swashplate type',
        swash_ring: 'Swashplate ring',
        swash_phase: 'Swashplate phase angle',
        swash_pitch_limit: 'Total pitch limit',
        swash_geo_correction: 'Geometry correction',
        swash_tta_precomp: 'TTA precompensation',
        tail_center_trim: 'Tail centre trim',
        tail_motor_idle: 'Tail motor idle',
        main_rotor_dir: 'Main rotor direction',
        tail_rotor_mode: 'Tail rotor mode',
        pid_process_denom: 'PID loop denominator',
        filter_process_denom: 'Filter loop denominator',
        error_limit: 'Error limit (roll, pitch, yaw)',
        offset_limit: 'Offset limit (roll, pitch)',
        iterm_relax_cutoff: 'I-term relax cutoff (roll, pitch, yaw)',
        iterm_relax_level: 'I-term relax level (roll, pitch, yaw)',
        yaw_cw_stop_gain: 'Yaw stop gain, clockwise',
        yaw_ccw_stop_gain: 'Yaw stop gain, counter-clockwise',
        yaw_cyclic_ff_gain: 'Yaw cyclic feedforward',
        yaw_collective_ff_gain: 'Yaw collective feedforward',
        pitch_collective_ff_gain: 'Pitch collective feedforward',
        cyclic_cross_coupling_gain: 'Cross coupling gain',
        cyclic_cross_coupling_ratio: 'Cross coupling ratio',
        cyclic_cross_coupling_cutoff: 'Cross coupling cutoff',
        setpoint_boost_cutoff: 'Setpoint boost cutoff (R, P, Y, C)',
        setpoint_boost_gain: 'Setpoint boost gain (R, P, Y, C)',
        telemetry_sensors: 'Custom telemetry sensors',
        crsf_telemetry_mode: 'CRSF telemetry mode',
        crsf_telemetry_link_rate: 'CRSF link rate',
        crsf_telemetry_link_ratio: 'CRSF link ratio',
        esc_sensor_protocol: 'ESC telemetry protocol',
        gyro_rpm_notch_preset: 'RPM notch preset',
        gyro_rpm_notch_min_hz: 'RPM notch minimum frequency',
        blackbox_initial_erase_kb: 'Initial erase size',
        rc_map: 'Channel map',
        rc_center: 'Stick centre',
        rc_deflection: 'Stick deflection',
        acc_hardware: 'Accelerometer hardware',
        align_board_roll: 'Board align, roll',
        align_board_pitch: 'Board align, pitch',
        align_board_yaw: 'Board align, yaw'
    };

    /* Word fixes for the automatic label generator. */
    var WORDS = {
        acc: 'Accelerometer', adc: 'ADC', adj: 'Adjustment', alt: 'Altitude',
        b: 'B', bat: 'Battery', bec: 'BEC', ccw: 'CCW', cw: 'CW', crsf: 'CRSF',
        d: 'D', dshot: 'DShot', dterm: 'D-term', dyn: 'Dynamic',
        esc: 'ESC', expo: 'Expo', f: 'F', ff: 'Feedforward', gps: 'GPS',
        gov: 'Governor', hz: 'Hz', i: 'I', ibat: 'Current', id: 'ID', imu: 'IMU',
        iterm: 'I-term', kb: 'kB', lpf: 'LPF', lpf1: 'LPF1', lpf2: 'LPF2',
        mag: 'Magnetometer', mah: 'mAh', max: 'Maximum', min: 'Minimum',
        ms: 'ms', msp: 'MSP', o: 'O', osd: 'OSD', p: 'P', pid: 'PID',
        pwm: 'PWM', rc: 'RC', rpm: 'RPM', rssi: 'RSSI', rx: 'RX',
        sd: 'SD', sp: 'Setpoint', spi: 'SPI', srate: 'Super rate',
        tlm: 'Telemetry', tta: 'TTA', tx: 'TX', usec: 'us', us: 'us',
        vbat: 'Voltage', vtx: 'VTX'
    };

    function prettify(name) {
        if (LABELS[name]) { return LABELS[name]; }
        var words = name.split('_');
        var out = words.map(function (w, i) {
            if (Object.prototype.hasOwnProperty.call(WORDS, w)) { return WORDS[w]; }
            if (/^\d+$/.test(w)) { return w; }
            return i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w;
        }).join(' ');
        return out.charAt(0).toUpperCase() + out.slice(1);
    }

    /* A unit is only shown when the setting name itself states one, so the
     * viewer never invents a scale it cannot verify. */
    function unitFor(name) {
        if (/_hz$/.test(name)) { return 'Hz'; }
        if (/_ms$/.test(name)) { return 'ms'; }
        if (/_us(ec)?$/.test(name)) { return 'us'; }
        if (/_kb$/.test(name)) { return 'kB'; }
        if (/_deg$/.test(name)) { return 'deg'; }
        if (/_time_s$/.test(name)) { return 's'; }
        if (/_dist_m$/.test(name)) { return 'm'; }
        return '';
    }

    function tabFor(name, meta) {
        for (var i = 0; i < NAME_TAB.length; i++) {
            if (NAME_TAB[i][0].test(name)) { return NAME_TAB[i][1]; }
        }
        if (meta && meta.pg && PG_TAB[meta.pg]) { return PG_TAB[meta.pg]; }
        return 'all';
    }

    /* Readable panel title for a leftover parameter group, e.g.
     * PG_VOLTAGE_SENSOR_ADC_CONFIG -> "Voltage Sensor ADC". */
    function pgTitle(pg) {
        if (!pg) { return 'Other settings'; }
        var t = pg.replace(/^PG_/, '').replace(/_CONFIG$/, '').replace(/_/g, ' ').toLowerCase();
        return t.replace(/\b([a-z])/g, function (m, c) { return c.toUpperCase(); })
                .replace(/\bAdc\b/, 'ADC').replace(/\bPid\b/, 'PID')
                .replace(/\bRx\b/, 'RX').replace(/\bGps\b/, 'GPS')
                .replace(/\bOsd\b/, 'OSD').replace(/\bLed\b/, 'LED')
                .replace(/\bVtx\b/, 'VTX').replace(/\bI2c\b/, 'I2C')
                .replace(/\bRpm\b/, 'RPM').replace(/\bImu\b/, 'IMU');
    }

    global.RFSchema = {
        TABS: TABS,
        SECTIONS: SECTIONS,
        PG_TAB: PG_TAB,
        tabFor: tabFor,
        prettify: prettify,
        unitFor: unitFor,
        pgTitle: pgTitle
    };
}(window));
