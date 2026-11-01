import { router } from 'expo-router';
import { AppHeader, EmptyState, Screen } from '../src/components/index.ts';

export default function NotFoundScreen() {
  return (
    <Screen header={<AppHeader title="Not found" back showBalance={false} />}>
      <EmptyState
        icon="compass-outline"
        title="This page doesn't exist"
        message="The link may be old or mistyped."
        actionLabel="Back to packs"
        onAction={() => router.replace('/')}
      />
    </Screen>
  );
}
