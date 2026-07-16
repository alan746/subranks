import { requestExpandedMode } from '@devvit/web/client';

const button = document.querySelector<HTMLButtonElement>('#open-app');

button?.addEventListener('click', (event) => {
  requestExpandedMode(event, 'app');
});
