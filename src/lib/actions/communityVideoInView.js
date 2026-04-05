/**
 * מפעיל וידאו בקארד "מהקהילה" כשהוא נכנס לתצוגה (טאץ' / iOS — בלי hover).
 * בדסקטופ אפשר עדיין לשלב עם hover דרך האירועים על אותו אלמנט.
 */
export function communityVideoInView(node) {
	const video = node.querySelector('.community-video');
	if (!video || typeof IntersectionObserver === 'undefined') {
		return {};
	}

	const observer = new IntersectionObserver(
		(entries) => {
			for (const entry of entries) {
				if (entry.isIntersecting && entry.intersectionRatio >= 0.3) {
					video.muted = true;
					video.play().catch(() => {});
				} else {
					video.pause();
				}
			}
		},
		{
			threshold: [0, 0.25, 0.35, 0.5, 0.75, 1],
			rootMargin: '24px 0px 32px 0px'
		}
	);

	observer.observe(node);

	return {
		destroy() {
			observer.disconnect();
		}
	};
}
