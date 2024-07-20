const { join } = await import('node:path');
const { cwd } = await import('node:process');
const xlsx = await import('node-xlsx');
const vkIo = await import('vk-io');
import readline from 'node:readline';
import { createReadStream } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import dayjs from 'dayjs';

const { api } = new vkIo.VK({
  token: 'edfaa111edfaa111edfaa11167eee87419eedfaedfaa1118e01b32883d4f18f2d345f32',
});

/* Declare data path */
const currentWorkingDir = cwd();
const usersFilePath = join(currentWorkingDir, 'users.xlsx');
const groupsFilePath = join(currentWorkingDir, 'groups.xlsx');
const keywordsFilePath = join(currentWorkingDir, 'keywords.txt');
const resultsDir = join(currentWorkingDir, 'results');

// Declare constants
const END_YEAR = 2019;

// Additional functions
async function processLineByLine(pathToFile: string) {
  const lines: string[] = [];

  const fileStream = createReadStream(pathToFile);

  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    lines.push(line.trim().toLocaleLowerCase());
  }

  return lines;
}

/* Read data from xlsx */
console.log(`Reading data...`);
const users = xlsx.parse(usersFilePath);
const groups = xlsx.parse(groupsFilePath);
const usersData = users[0].data.slice(1);
const groupsData = groups[0].data.slice(1);
const keywords = await processLineByLine(keywordsFilePath);
console.log(`Complete read data...`);

const chunkRowsLimit = 10000;
let currentChunkIndex = 0;
let currentChunk: Array<string[]> = [];

async function getPostsCount(id: number, type: 'id' | 'public') {
  try {
    return (
      await api.wall.get({
        owner_id: type === 'id' ? id : Math.abs(id) * -1,
        filter: 'all',
      })
    ).count;
  } catch (err) {
    return 0;
  }
}

function getDirectPostUrl(type: 'id' | 'public', ownerId: number, postId: number) {
  return `https://vk.com/${type === 'id' ? 'id' : 'public'}${Math.abs(ownerId) * 1}?w=wall${ownerId}_${postId}`;
}

function getDirectCommentUrl(type: 'id' | 'public', ownerId: number, postId: number, commentId: number) {
  return `https://vk.com/${type === 'id' ? 'id' : 'public'}${Math.abs(ownerId) * 1}?w=wall${ownerId}_${postId}_r${commentId}`;
}

function* createPostsReader(type: 'id' | 'public', ownerId: number, count: number, depth = 0, take = 100) {
  const ownerId2 = type === 'id' ? ownerId : Math.abs(ownerId) * -1;
  let skip = 0;
  let rest = depth === 0 ? count : depth;

  while (rest !== 0) {
    // console.log(`[posts_reader] skip=${skip}, rest=${rest} rest-skip${rest-skip}`)

    if (rest > take) {
      yield api.wall.get({
        owner_id: ownerId2,
        filter: 'all',
        count: take,
        offset: skip,
      });

      skip = skip + take;
      rest = rest - take;
    }

    if (rest <= take) {
      yield api.wall.get({
        owner_id: ownerId2,
        filter: 'all',
        count: rest,
        offset: skip,
      });

      skip = skip + rest;
      rest = 0;
    }
  }
}

function* createCommentsReader(
  type: 'id' | 'public',
  ownerId: number,
  postId: number,
  count: number,
  depth = 0,
  take = 100,
) {
  const ownerId2 = type === 'id' ? ownerId : Math.abs(ownerId) * -1;
  let skip = 0;
  let rest = depth === 0 ? count : depth;

  while (rest !== 0) {
    if (rest > take) {
      yield api.wall.getComments({
        owner_id: ownerId2,
        post_id: postId,
        count: take,
        offset: skip,
      });

      skip = skip + take;
      rest = rest - take;
    }

    if (rest <= take) {
      yield api.wall.getComments({
        owner_id: ownerId2,
        post_id: postId,
        count: rest,
        offset: skip,
      });

      skip = skip + rest;
      rest = 0;
    }
  }
}

async function processingUser() {
  for (const userDataRow of usersData) {
    const userId = userDataRow['1'];
    const [userProfileData] = await api.users.get({ user_ids: [userId] });

    if (userProfileData.is_closed) continue;
    const postsCount = await getPostsCount(userId, 'id');
    const postsReader = createPostsReader('id', userId, postsCount, 0);

    for (const postsPromise of postsReader) {
      const { items: posts } = await postsPromise;
      const isEnd = posts.find((post) => !(Number(dayjs(dayjs.unix(post.date)).format('YYYY')) > END_YEAR));

      if (isEnd) {
        break;
      }

      for (const post of posts) {
        console.log(dayjs(dayjs.unix(post.date)));

        /* -------------------------- Processing post text -------------------------- */
        if (post.text) {
          if (!post.text) continue;

          const detectedKeywords: string[] = [];

          for (const keyword of keywords) {
            const isInclude = post.text.trim().toLocaleLowerCase().includes(keyword);
            if (isInclude) {
              detectedKeywords.push(keyword);
            }
          }

          if (detectedKeywords.length > 0) {
            console.log(
              `[POST][${getDirectPostUrl('id', post.owner_id, post.id)}] -> ${post.text.slice(0, 25)} (${detectedKeywords.join(',')})`,
            );
            if (currentChunk.length < chunkRowsLimit) {
              currentChunk.push([
                'POST',
                getDirectPostUrl('id', post.owner_id, post.id),
                post.text,
                detectedKeywords.join(','),
              ]);
            }

            if (currentChunk.length === chunkRowsLimit) {
              const buffer = xlsx.build([{ name: `chunk-${currentChunkIndex}`, data: currentChunk, options: {} }]);

              await writeFile(join(resultsDir, `chunk-${currentChunkIndex}.xlsx`), buffer);
              currentChunk = [];
              currentChunkIndex = currentChunkIndex + 1;

              currentChunk.push([
                'POST',
                getDirectPostUrl('id', post.owner_id, post.id),
                post.text,
                detectedKeywords.join(','),
              ]);
            }
          }
        }

        /* ------------------------ Processing post comments ------------------------ */
        if (post.comments.count > 0) {
          const commentsReader = createCommentsReader('id', post.owner_id, post.id, post.comments.count, 0);

          for (const commentsPromise of commentsReader) {
            const { items: comments } = await commentsPromise;
            for (const comment of comments) {
              if (!comment.text) continue;

              const detectedKeywords: string[] = [];

              for (const keyword of keywords) {
                const isInclude = comment.text.trim().toLocaleLowerCase().includes(keyword);
                if (isInclude) {
                  detectedKeywords.push(keyword);
                }
              }

              if (detectedKeywords.length > 0) {
                console.log(
                  `[COMMENT][${getDirectCommentUrl('id', comment.owner_id, comment.post_id, comment.id)}] -> "${comment.text.slice(0, 25)}" ${detectedKeywords.join(',')}`,
                );

                if (currentChunk.length < chunkRowsLimit) {
                  currentChunk.push([
                    'COMMENT',
                    getDirectCommentUrl('id', comment.owner_id, comment.post_id, comment.id),
                    comment.text,
                    detectedKeywords.join(','),
                  ]);
                }

                if (currentChunk.length === chunkRowsLimit) {
                  const buffer = xlsx.build([{ name: `chunk-${currentChunkIndex}`, data: currentChunk, options: {} }]);

                  await writeFile(join(resultsDir, `chunk-${currentChunkIndex}.xlsx`), buffer);
                  currentChunk = [];
                  currentChunkIndex = currentChunkIndex + 1;

                  currentChunk.push([
                    'COMMENT',
                    getDirectCommentUrl('id', comment.owner_id, comment.post_id, comment.id),
                    comment.text,
                    detectedKeywords.join(','),
                  ]);
                }
              }
            }
          }
        }
      }
    }

    const buffer = xlsx.build([{ name: `chunk-${currentChunkIndex}`, data: currentChunk, options: {} }]);
    await writeFile(join(resultsDir, `chunk-${currentChunkIndex}.xlsx`), buffer);
  }
}

async function processingPublics() {
  for (const groupDataRow of groupsData) {
    const groupId = groupDataRow['1'];
    const {
      groups: [groupDetails],
    } = await api.groups.getById({ group_ids: [groupId] });

    if (groupDetails.is_closed || groupDetails.name === 'DELETED') continue;
    const postsCount = await getPostsCount(groupDetails.id, groupId);

    // console.log(`Processing group ${groupDetails.name} | ${groupDetails.type} | pos  ts count ${postsCount}`)

    const postsReader = createPostsReader('public', groupId, postsCount);

    for (const postsPromise of postsReader) {
      const { items: posts } = await postsPromise;
      const isEnd = posts.find((post) => !(Number(dayjs(dayjs.unix(post.date)).format('YYYY')) > END_YEAR));

      if (isEnd) {
        break;
      }

      for (const post of posts) {
        /* -------------------------- Processing post text -------------------------- */
        if (post.text) {
          if (!post.text) continue;

          const detectedKeywords: string[] = [];

          for (const keyword of keywords) {
            const isInclude = post.text.trim().toLocaleLowerCase().includes(keyword);
            if (isInclude) {
              detectedKeywords.push(keyword);
            }
          }

          if (detectedKeywords.length > 0) {
            console.log(
              `[POST][${getDirectPostUrl('public', post.owner_id, post.id)}] -> ${post.text.slice(0, 25)} (${detectedKeywords.join(',')})`,
            );

            if (currentChunk.length < chunkRowsLimit) {
              currentChunk.push([
                'POST',
                getDirectPostUrl('public', post.owner_id, post.id),
                post.text,
                detectedKeywords.join(','),
              ]);
            }

            if (currentChunk.length === chunkRowsLimit) {
              const buffer = xlsx.build([{ name: `chunk-${currentChunkIndex}`, data: currentChunk, options: {} }]);

              await writeFile(join(resultsDir, `chunk-${currentChunkIndex}.xlsx`), buffer);
              currentChunk = [];
              currentChunkIndex = currentChunkIndex + 1;

              currentChunk.push([
                'POST',
                getDirectPostUrl('public', post.owner_id, post.id),
                post.text,
                detectedKeywords.join(','),
              ]);
            }
          }
        }

        /* ------------------------ Processing post comments ------------------------ */
        if (post.comments.count > 0) {
          const commentsReader = createCommentsReader('public', post.owner_id, post.id, post.comments.count, 0);

          for (const commentsPromise of commentsReader) {
            const { items: comments } = await commentsPromise;
            for (const comment of comments) {
              if (!comment.text) continue;

              const detectedKeywords: string[] = [];

              // Search keywords in comments
              for (const keyword of keywords) {
                const isInclude = comment.text.trim().toLocaleLowerCase().includes(keyword);
                if (isInclude) {
                  detectedKeywords.push(keyword);
                }
              }

              if (detectedKeywords.length > 0) {
                console.log(
                  `[COMMENT][${getDirectCommentUrl('public', comment.owner_id, comment.post_id, comment.id)}] -> ${comment.text.slice(0, 25)} (${detectedKeywords.join(',')})`,
                );

                // If buffer not overflow
                if (currentChunk.length < chunkRowsLimit) {
                  currentChunk.push([
                    'COMMENT',
                    getDirectCommentUrl('public', comment.owner_id, comment.post_id, comment.id),
                    comment.text,
                    detectedKeywords.join(','),
                  ]);
                }

                // If buffer is overflow
                if (currentChunk.length === chunkRowsLimit) {
                  const buffer = xlsx.build([{ name: `chunk-${currentChunkIndex}`, data: currentChunk, options: {} }]);

                  await writeFile(join(resultsDir, `chunk-${currentChunkIndex}.xlsx`), buffer);
                  currentChunk = [];
                  currentChunkIndex = currentChunkIndex + 1;

                  currentChunk.push([
                    'COMMENT',
                    getDirectCommentUrl('public', comment.owner_id, comment.post_id, comment.id),
                    comment.text,
                    detectedKeywords.join(','),
                  ]);
                }
              }
            }
          }
        }
      }
    }

    const buffer = xlsx.build([{ name: `chunk-${currentChunkIndex}`, data: currentChunk, options: {} }]);
    await writeFile(join(resultsDir, `chunk-${currentChunkIndex}.xlsx`), buffer);
  }
}

process.on('SIGINT', async function () {
  console.log('Save results, please wait...');
  const buffer = xlsx.build([{ name: `chunk-${currentChunkIndex}`, data: currentChunk, options: {} }]);
  await writeFile(join(resultsDir, `chunk-${currentChunkIndex}.xlsx`), buffer);
  console.log(`Results saved!, shutdown process...`);
  process.exit();
});

await processingPublics();
await processingUser();
