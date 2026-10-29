# Pi Lab

> **Note:** This project was made by AI for educational purposes. It was not made by me (ANURAG).

A Raspberry Pi circuit simulator that runs entirely in your browser.

**Open it:** https://anurag0224q.github.io/pi-lab/

- Raspberry Pi 4 / Pi 5 / Pi Zero 2 W with the real 40-pin header (physical + BCM numbering)
- 1,131 real parts: sensors (DHT22, HC-SR04, PIR, MQ gas, BME280, MPU6050…), displays, motors, drivers, relays, passives
- Drag, wire, pan/zoom, undo/redo, touch support
- Write Python with RPi.GPIO / gpiozero and run it in the browser (Python runs locally via Pyodide)
- Electrical checks: 5V on a GPIO, LEDs without resistors, shorts, over-current, wrong I2C pins, unconnected pins
- Save / open / export / import projects; installable as an app and works offline after the first visit

Static site: everything in this repository is served as-is by GitHub Pages (main branch, root).
