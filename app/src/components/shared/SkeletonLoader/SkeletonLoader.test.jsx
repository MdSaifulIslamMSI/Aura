import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import SkeletonLoader from './index';

describe('SkeletonLoader', () => {
  it('renders a single card skeleton by default', () => {
    const { container } = render(<SkeletonLoader />);
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
  });

  it('renders the requested number of skeletons', () => {
    const { container } = render(<SkeletonLoader count={3} />);
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(3);
  });

  it('renders zero skeletons for count=0', () => {
    const { container } = render(<SkeletonLoader count={0} />);
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(0);
  });

  it('renders list and grid variants without crashing', () => {
    for (const type of ['list', 'grid', 'unknown-type']) {
      const { container, unmount } = render(<SkeletonLoader type={type} />);
      expect(container.querySelector('.animate-pulse')).not.toBeNull();
      unmount();
    }
  });

  it('merges custom class names', () => {
    const { container } = render(<SkeletonLoader className="my-loader" />);
    expect(container.querySelector('.my-loader')).not.toBeNull();
  });
});
