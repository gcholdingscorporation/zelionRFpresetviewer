# Rotorflight Blackbox Analyser

A desktop tool that reads Rotorflight `.BBL` / `.BFL` blackbox logs and prints a
plain-text tuning report. It does not talk to a flight controller and cannot
change one. It reads a file and tells you what is in it.

## Install

Needs Python 3 with Tk (the python.org Windows installer includes it).

Install the two libraries **one command at a time** — `orangebox` emits a
harmless packaging error that aborts anything queued behind it in the same
command:

    python -m pip install numpy
    python -m pip install orangebox

## Run

Double-click `RFLogTool.bat` (or `RFLogTool.pyw` if `.pyw` is associated with
Python). Press **Open blackbox log(s)...**, pick one or more logs, wait. Large
logs take a few minutes — the decoder is pure Python.

**Copy all** puts the whole report on the clipboard. **Save report...** writes
it to a file.

## What it reports

Per flight, restricted to airborne frames only (spool-up and spool-down are
excluded so they do not skew the statistics):

- Logging rate, and the highest frequency that rate can actually resolve
- Governor: headspeed mean, standard deviation, worst droop, oscillation
- Per axis: gyro and setpoint rms, tracking error, response lag, correlation
- Gyro spectrum, with peaks automatically tagged against main- and tail-rotor
  harmonics so mechanical vibration is labelled as such
- Energy split across 1-8 / 8-30 / 30-60 / 60+ Hz
- P, I, D, F, B and O term magnitudes
- Debug channels (pre-filter gyro under `GYRO_SCALED`), which show vibration
  that the RPM notches remove before it reaches the normal gyro trace
- Cyclic cross-coupling: roll response to isolated pitch input, and vice versa
- Tail coupling: correlation of yaw error against collective and cyclic movement
- Servo travel-limit saturation, motor output, voltage and current
- A full inventory of every field and header in the file

It ends with a summary of anything worth looking at, and how many of the
analysed flights each item showed up in.

## Limitations

- The normal gyro trace is **post-filter**. Absence of a 1/rev peak there does
  not prove absence of vibration; check the debug channels for that.
- Resolution is capped by the logging rate. Below about 1 kHz, D-term noise and
  higher rotor harmonics may be invisible.
- It reports measurements. Deciding what to change remains a judgement call.
