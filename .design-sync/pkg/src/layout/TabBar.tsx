import { Icon, type IconName } from './Icon';

export interface Tab {
  label: string;
  icon: IconName;
  href?: string;
  /** The page being shown. */
  current?: boolean;
}

export interface TabBarProps {
  /** Stops, Map, Transit Center, and a season's own while it lasts (Pumpkin Walk). Equal widths, as many as given. */
  tabs: Tab[];
}

/**
 * The phone's bottom tab bar: an icon over each label, the current tab in the accent with a 2 px line along its top.
 * The app shows it under 840 px wide only (wider, the same tabs are links in the top bar); as a part it shows wherever it's put.
 */
export function TabBar({ tabs }: TabBarProps) {
  return (
    <nav id="tabs" className="cr-tabbar">
      {tabs.map(t => <a key={t.label} href={t.href || '#'} aria-current={t.current ? 'page' : undefined}><Icon name={t.icon} size={22} />{t.label}</a>)}
    </nav>
  );
}
