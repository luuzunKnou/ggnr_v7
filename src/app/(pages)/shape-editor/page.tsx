import { getDefaultMapCenterFromFooter } from '@/service/configService';
import ShapeEditorMapClient from './ShapeEditorMapClient';

export default async function ShapeEditorPage() {
  const projectName = (process.env.GGNR_PROJECT ?? 'build_yy').trim() || 'build_yy';
  const defaultCenter = await getDefaultMapCenterFromFooter();
  return <ShapeEditorMapClient projectName={projectName} defaultCenter={defaultCenter} />;
}
