import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';

import { useTheme } from '@/hooks/use-theme';

export default function LayoutPestanas() {
  const tema = useTheme();

  return (
    <Tabs
      screenOptions={{
        // Cada pestaña dibuja su propio encabezado grande.
        headerShown: false,
        tabBarActiveTintColor: tema.primarioTinta,
        tabBarInactiveTintColor: tema.textSecondary,
        tabBarStyle: { backgroundColor: tema.background, borderTopColor: tema.borde },
        headerStyle: { backgroundColor: tema.background },
        headerTitleStyle: { color: tema.text },
        headerShadowVisible: false,
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Cartera',
          tabBarIcon: ({ color, size }) => <Ionicons name="wallet" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="clientes"
        options={{
          title: 'Clientes',
          tabBarIcon: ({ color, size }) => <Ionicons name="people" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="caja"
        options={{
          title: 'Caja',
          tabBarIcon: ({ color, size }) => <Ionicons name="cash" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="reportes"
        options={{
          title: 'Reportes',
          tabBarIcon: ({ color, size }) => <Ionicons name="stats-chart" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="ajustes"
        options={{
          title: 'Ajustes',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="settings-sharp" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
