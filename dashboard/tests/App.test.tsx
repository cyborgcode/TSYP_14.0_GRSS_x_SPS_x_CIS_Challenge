import { render, screen } from '@testing-library/react';
import App from '../src/App';

describe('App', () => {
  it('renders the project heading', () => {
    render(<App />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('tsyp');
  });
});
