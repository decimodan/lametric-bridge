# Problem definition

El objetivo de este software debe ser:

1. Actuar como un **hub de notificaciones** en la LAN: distintas apps y sensores mandan eventos; el puente decide cómo mostrarlos en los dispositivos de salida
2. Hoy las salidas son relojes pixel (LaMetric Time, Ulanzi / AWTRIX). Más adelante se sumarán otras marcas y aparatos (Hue, Aqara, etc.) sin cambiar el contrato de ingest
3. Debe exponer una interfaz para poder conectar diferentes aplicaciones
3.1 Las aplicaciones mandan datos; la responsabilidad de este puente es enrutarlos y mostrarlos en el dispositivo elegido
4. Debe tener un panel para poder configurar esta información
5. Las aplicaciones deben de poder configurar facilmente las notificaciones
6. Debe poder conectar información de Home Assistant (y elegir cual mostrar y como)
7. Todo debe configurarse desde WiFi
8. Considera que se montará como un aplicativo en Dokploy
9. Las aplicaciones que se conectan son de la red local
