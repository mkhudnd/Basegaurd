import React from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {COLORS, FONTS} from './components';

type Props = {
  title: string;
  subtitle: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  color?: string;
  onPress: () => void;
  disabled?: boolean;
};

export function HomeQuickAction({title, subtitle, icon, color = COLORS.primary, onPress, disabled}: Props) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityHint={subtitle}
      accessibilityState={{disabled: !!disabled}} disabled={disabled} onPress={onPress}
      style={({pressed}) => [homeStyles.tile, pressed && homeStyles.pressed, disabled && homeStyles.disabled]}>
      <Ionicons name={icon} size={40} color={color}/>
      <Text style={homeStyles.title}>{title}</Text>
      <Text style={homeStyles.subtitle}>{subtitle}</Text>
    </Pressable>
  );
}

export function StatCard({label, value}: {label:string; value:number|string}) {
  return <View accessible accessibilityLabel={label+' '+value} style={homeStyles.stat}>
    <Text style={homeStyles.value}>{value}</Text><Text style={homeStyles.subtitle}>{label}</Text>
  </View>;
}

export function HomeActions({children}: React.PropsWithChildren) {
  return <View style={homeStyles.grid}>{children}</View>;
}

export const homeStyles = StyleSheet.create({
  stat:{flexBasis:'47%',flexGrow:1,minHeight:72,padding:12,alignItems:'center',justifyContent:'center',backgroundColor:COLORS.surface,borderRadius:12,borderWidth:1,borderColor:COLORS.border},
  value:{fontFamily:FONTS.bold,fontSize:24,color:COLORS.navy},
  grid: {flexDirection: 'row', flexWrap: 'wrap', gap: 12},
  tile: {flexBasis: '47%', flexGrow: 1, minHeight: 112, padding: 12, gap: 6, alignItems:'center', justifyContent:'center',
    backgroundColor: COLORS.white, borderWidth: 1, borderColor: COLORS.border, borderRadius: 12},
  title: {fontFamily: FONTS.bold, fontWeight: '700', fontSize: 16, textAlign:'center', color: COLORS.navy},
  subtitle: {fontFamily: FONTS.regular, fontSize: 12, lineHeight: 16, textAlign:'center', color: COLORS.textMuted},
  heading: {fontFamily: FONTS.bold, fontWeight: '700', fontSize: 17, color: COLORS.navy},
  pressed: {backgroundColor: COLORS.primarySoft},
  disabled: {opacity: 0.5},
});
