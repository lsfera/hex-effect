<script lang="ts">
  import { enhance } from '$app/forms';
  import type { PageData } from './$types';
  export let data: PageData;
</script>

{#if data.project}
  <h2>{data.project.title}</h2>
  <h3>Tasks</h3>
  <ul>
    {#each data.tasks as task}
      <li>
        {task.description}
        <form method="POST" action="?/removeTask" use:enhance style="display:inline">
          <input type="hidden" name="taskId" value={task.id} />
          <button type="submit">Remove</button>
        </form>
      </li>
    {/each}
  </ul>
  <form method="POST" action="?/addTask" use:enhance>
    <input type="text" name="description" placeholder="Task description" required />
    <button>Add Task</button>
  </form>
{:else}
  <p>Project not found.</p>
{/if}
