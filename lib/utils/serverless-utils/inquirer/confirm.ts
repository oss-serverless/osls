import inquirer from './index.ts';

export default async (message, options = {}) => {
  const name = options.name || 'isConfirmed';

  return (
    await inquirer.prompt({
      message,
      type: 'confirm',
      name,
    })
  )[name];
};
