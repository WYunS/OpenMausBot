import assert from 'node:assert/strict';

export function releaseRepository(env = process.env) {
  const repository = env.GITHUB_REPOSITORY || 'AI-Applications-Team/OpenMausBot';
  assert(['AI-Applications-Team/OpenMausBot', 'WYunS/OpenMausBot'].includes(repository),
    'Use an approved RuijieBot release repository');
  const [owner, repo] = repository.split('/');
  return { repository, owner, repo };
}
