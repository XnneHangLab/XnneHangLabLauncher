import '../../styles/community.css';

export function CommunityPage() {
  return (
    <div className="community-page">
      <h2 className="community-section-title">交流群</h2>
      <p className="community-hint">
        项目正在积极开发中，交流群即将开放。<br />
        敬请关注后续更新公告。
      </p>

      <div className="community-coming-soon">
        <span className="community-coming-soon__icon">🚀</span>
        <span className="community-coming-soon__text">即将开放，敬请期待</span>
      </div>
    </div>
  );
}
